// Gateway MCP loopback JSON-RPC handlers.
// Implements initialize, tools/list, tools/call, and notification handling.
import crypto from "node:crypto";
import { runBeforeToolCallHook, type HookContext } from "../agents/agent-tools.before-tool-call.js";
import { formatErrorMessage } from "../infra/errors.js";
import { readEnforcementMetadataFromMessage } from "../security/enforcement-metadata.js";
import {
  MCP_LOOPBACK_SERVER_NAME,
  MCP_LOOPBACK_SERVER_VERSION,
  MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS,
  jsonRpcError,
  jsonRpcResult,
  type JsonRpcRequest,
} from "./mcp-http.protocol.js";
import {
  readMcpLoopbackToolName,
  type McpLoopbackTool,
  type McpToolSchemaEntry,
} from "./mcp-http.schema.js";

type McpTextContent = {
  type: "text";
  text: string;
};

const OPENCLAW_MCP_ENFORCEMENT_METADATA_META_KEY = "openclaw/enforcementMetadata";

// Tool implementations may return MCP content blocks, plain strings, or
// arbitrary JSON. Normalize them into text blocks for consistent loopback output.
function normalizeToolCallContent(result: unknown): McpTextContent[] {
  const content = (result as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    return content.map((block: { type?: string; text?: string }) => ({
      type: (block.type ?? "text") as "text",
      text: block.text ?? (typeof block === "string" ? block : JSON.stringify(block)),
    }));
  }
  return [
    {
      type: "text",
      text: typeof result === "string" ? result : JSON.stringify(result),
    },
  ];
}

function resolveToolCallResultMeta(result: unknown): Record<string, unknown> | undefined {
  const enforcementMetadata = readEnforcementMetadataFromMessage(
    result as { enforcementMetadata?: unknown; details?: unknown } | undefined,
  );
  if (!enforcementMetadata) {
    return undefined;
  }
  return {
    [OPENCLAW_MCP_ENFORCEMENT_METADATA_META_KEY]: enforcementMetadata,
  };
}

/** Handles one MCP loopback JSON-RPC message and returns a response or notification null. */
export async function handleMcpJsonRpc(params: {
  message: JsonRpcRequest;
  tools: McpLoopbackTool[];
  toolSchema: McpToolSchemaEntry[];
  hookContext?: HookContext;
  signal?: AbortSignal;
  onToolCallResult?: (call: {
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    isError: boolean;
  }) => void;
  onToolCallPrepared?: (call: { toolName: string; args: Record<string, unknown> }) => void;
}): Promise<object | null> {
  const { id, method, params: methodParams } = params.message;

  switch (method) {
    case "initialize": {
      const clientVersion = (methodParams?.protocolVersion as string) ?? "";
      // Prefer the client-requested protocol when supported, otherwise fall
      // back to the newest/first supported version advertised by this server.
      const negotiated =
        MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS.find((version) => version === clientVersion) ??
        MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS[0];
      return jsonRpcResult(id, {
        protocolVersion: negotiated,
        capabilities: { tools: {} },
        serverInfo: {
          name: MCP_LOOPBACK_SERVER_NAME,
          version: MCP_LOOPBACK_SERVER_VERSION,
        },
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "tools/list":
      return jsonRpcResult(id, { tools: params.toolSchema });
    case "tools/call": {
      const toolName = typeof methodParams?.name === "string" ? methodParams.name.trim() : "";
      const toolArgs = (methodParams?.arguments ?? {}) as Record<string, unknown>;
      if (!toolName) {
        return jsonRpcResult(id, {
          content: [{ type: "text", text: "Tool not available: unknown" }],
          isError: true,
        });
      }
      if (!params.toolSchema.some((tool) => tool.name === toolName)) {
        return jsonRpcResult(id, {
          content: [{ type: "text", text: `Tool not available: ${toolName}` }],
          isError: true,
        });
      }
      const tool = params.tools.find(
        (candidate) => readMcpLoopbackToolName(candidate) === toolName,
      );
      if (!tool) {
        return jsonRpcResult(id, {
          content: [{ type: "text", text: `Tool not available: ${toolName}` }],
          isError: true,
        });
      }
      const toolCallId = `mcp-${crypto.randomUUID()}`;
      let executedToolArgs = toolArgs;
      const reportToolCallResult = (result: unknown, isError: boolean) => {
        try {
          params.onToolCallResult?.({
            toolName,
            args: executedToolArgs,
            result,
            isError,
          });
        } catch {
          // Observability callbacks must never alter the tool result returned to the MCP client.
        }
      };
      try {
        // Gateway before-tool hooks still run for loopback MCP calls so policy
        // and audit behavior matches native tool calls from normal chat runs.
        const hookResult = await runBeforeToolCallHook({
          toolName,
          params: toolArgs,
          toolCallId,
          ctx: params.hookContext,
          signal: params.signal,
        });
        if (hookResult.blocked) {
          return jsonRpcResult(id, {
            content: [{ type: "text", text: hookResult.reason }],
            isError: true,
          });
        }
        executedToolArgs = hookResult.params as Record<string, unknown>;
        try {
          params.onToolCallPrepared?.({ toolName, args: executedToolArgs });
        } catch {
          // Observability callbacks must never alter the tool result returned to the MCP client.
        }
        const result = await tool.execute(toolCallId, hookResult.params, params.signal);
        reportToolCallResult(result, false);
        const resultMeta = resolveToolCallResultMeta(result);
        return jsonRpcResult(id, {
          ...(resultMeta ? { _meta: resultMeta } : {}),
          content: normalizeToolCallContent(result),
          isError: false,
        });
      } catch (error) {
        reportToolCallResult(error, true);
        const message = formatErrorMessage(error);
        return jsonRpcResult(id, {
          content: [{ type: "text", text: message || "tool execution failed" }],
          isError: true,
        });
      }
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}
