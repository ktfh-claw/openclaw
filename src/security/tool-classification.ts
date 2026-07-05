import type { AnyAgentTool } from "../agents/tools/common.js";

export const TOOL_CLASSIFICATION_VERSION = 1 as const;

export const TOOL_CONSEQUENCE_KIND_VALUES = [
  "host_execution",
  "network_egress",
  "remote_file_access",
  "remote_control",
] as const;

export type ToolConsequenceKind = (typeof TOOL_CONSEQUENCE_KIND_VALUES)[number];

export const TOOL_UNTRUSTED_CONTENT_SOURCE_KIND_VALUES = [
  "network_response",
  "browser_page",
  "remote_file",
] as const;

export type ToolUntrustedContentSourceKind =
  (typeof TOOL_UNTRUSTED_CONTENT_SOURCE_KIND_VALUES)[number];

export const TOOL_ARGUMENT_FLOW_KIND_VALUES = [
  "content",
  "destination",
  "command",
  "locator",
] as const;

export type ToolArgumentFlowKind = (typeof TOOL_ARGUMENT_FLOW_KIND_VALUES)[number];

export type ToolArgumentClassification = {
  path: string;
  kind: ToolArgumentFlowKind;
};

export type ToolClassification = {
  version: typeof TOOL_CLASSIFICATION_VERSION;
  consequential?: readonly ToolConsequenceKind[];
  untrustedContentSource?: readonly ToolUntrustedContentSourceKind[];
  egressArguments?: readonly ToolArgumentClassification[];
};

const toolClassificationByTool = new WeakMap<AnyAgentTool, ToolClassification>();

const MILESTONE_TOOL_CLASSIFICATIONS: Readonly<Record<string, ToolClassification>> = {
  browser: {
    version: TOOL_CLASSIFICATION_VERSION,
    consequential: ["network_egress", "remote_control"],
    untrustedContentSource: ["browser_page"],
    egressArguments: [
      { path: "url", kind: "locator" },
      { path: "targetUrl", kind: "locator" },
      { path: "text", kind: "content" },
      { path: "promptText", kind: "content" },
      { path: "request.text", kind: "content" },
      { path: "request.url", kind: "locator" },
    ],
  },
  exec: {
    version: TOOL_CLASSIFICATION_VERSION,
    consequential: ["host_execution"],
    egressArguments: [
      { path: "cmd", kind: "command" },
      { path: "command", kind: "command" },
    ],
  },
  file_fetch: {
    version: TOOL_CLASSIFICATION_VERSION,
    consequential: ["remote_file_access"],
    untrustedContentSource: ["remote_file"],
    egressArguments: [
      { path: "node", kind: "destination" },
      { path: "path", kind: "locator" },
    ],
  },
  gateway: {
    version: TOOL_CLASSIFICATION_VERSION,
    consequential: ["network_egress", "remote_control"],
    egressArguments: [
      { path: "method", kind: "destination" },
      { path: "params", kind: "content" },
      { path: "gatewayUrl", kind: "locator" },
    ],
  },
  message: {
    version: TOOL_CLASSIFICATION_VERSION,
    consequential: ["network_egress"],
    egressArguments: [
      { path: "message", kind: "content" },
      { path: "caption", kind: "content" },
      { path: "presentation", kind: "content" },
      { path: "pollQuestion", kind: "content" },
      { path: "pollOption", kind: "content" },
      { path: "target", kind: "destination" },
      { path: "targets", kind: "destination" },
      { path: "channel", kind: "destination" },
      { path: "channelId", kind: "destination" },
      { path: "threadId", kind: "destination" },
      { path: "media", kind: "locator" },
      { path: "path", kind: "locator" },
    ],
  },
  web_fetch: {
    version: TOOL_CLASSIFICATION_VERSION,
    untrustedContentSource: ["network_response"],
    egressArguments: [{ path: "url", kind: "locator" }],
  },
  web_search: {
    version: TOOL_CLASSIFICATION_VERSION,
    untrustedContentSource: ["network_response"],
    egressArguments: [{ path: "query", kind: "content" }],
  },
};

function isConsequenceKind(value: unknown): value is ToolConsequenceKind {
  return (
    typeof value === "string" && (TOOL_CONSEQUENCE_KIND_VALUES as readonly string[]).includes(value)
  );
}

function isUntrustedContentSourceKind(value: unknown): value is ToolUntrustedContentSourceKind {
  return (
    typeof value === "string" &&
    (TOOL_UNTRUSTED_CONTENT_SOURCE_KIND_VALUES as readonly string[]).includes(value)
  );
}

function isArgumentFlowKind(value: unknown): value is ToolArgumentFlowKind {
  return (
    typeof value === "string" &&
    (TOOL_ARGUMENT_FLOW_KIND_VALUES as readonly string[]).includes(value)
  );
}

function normalizeStringArray<T extends string>(
  value: unknown,
  predicate: (entry: unknown) => entry is T,
): readonly T[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every(predicate)) {
    return undefined;
  }
  return Object.freeze([...value]);
}

function normalizeArgumentClassification(value: unknown): ToolArgumentClassification | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.path !== "string" || !record.path.trim() || !isArgumentFlowKind(record.kind)) {
    return undefined;
  }
  return { path: record.path, kind: record.kind };
}

function normalizeArgumentClassifications(
  value: unknown,
): readonly ToolArgumentClassification[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const normalized = value.map(normalizeArgumentClassification);
  if (normalized.some((entry) => !entry)) {
    return undefined;
  }
  return Object.freeze(normalized as ToolArgumentClassification[]);
}

export function normalizeToolClassification(value: unknown): ToolClassification | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const version =
    record.version === TOOL_CLASSIFICATION_VERSION ? TOOL_CLASSIFICATION_VERSION : undefined;
  if (!version) {
    return undefined;
  }
  const consequential = normalizeStringArray(record.consequential, isConsequenceKind);
  const untrustedContentSource = normalizeStringArray(
    record.untrustedContentSource,
    isUntrustedContentSourceKind,
  );
  const egressArguments = normalizeArgumentClassifications(record.egressArguments);
  if (!consequential && !untrustedContentSource && !egressArguments) {
    return undefined;
  }
  return {
    version,
    ...(consequential ? { consequential } : {}),
    ...(untrustedContentSource ? { untrustedContentSource } : {}),
    ...(egressArguments ? { egressArguments } : {}),
  };
}

export function setToolClassification(tool: AnyAgentTool, metadata: unknown): ToolClassification {
  const normalized = normalizeToolClassification(metadata);
  if (!normalized) {
    throw new Error(`Invalid tool classification metadata for tool "${tool.name}"`);
  }
  toolClassificationByTool.set(tool, normalized);
  return normalized;
}

export function getToolClassification(tool: AnyAgentTool): ToolClassification | undefined {
  return toolClassificationByTool.get(tool);
}

export function requireToolClassification(tool: AnyAgentTool): ToolClassification {
  const classification = getToolClassification(tool);
  if (!classification) {
    throw new Error(`Missing tool classification metadata for tool "${tool.name}"`);
  }
  return classification;
}

export function copyToolClassification(source: AnyAgentTool, target: AnyAgentTool): void {
  const classification = toolClassificationByTool.get(source);
  if (classification) {
    toolClassificationByTool.set(target, classification);
  }
}

export function annotateMilestoneToolClassifications(
  tools: readonly AnyAgentTool[],
): AnyAgentTool[] {
  return tools.map((tool) => {
    const classification = MILESTONE_TOOL_CLASSIFICATIONS[tool.name];
    if (classification) {
      setToolClassification(tool, classification);
    }
    return tool;
  });
}

export const testing = {
  MILESTONE_TOOL_CLASSIFICATIONS,
};
