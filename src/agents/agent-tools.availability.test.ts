/**
 * Tests baseline tool availability for assembled agent tools.
 * Ensures control-plane tools remain present and node-originated runs receive
 * the restricted node-safe subset.
 */
import { describe, expect, it, vi } from "vitest";
import { requireToolClassification } from "../security/tool-classification.js";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-openclaw-tools.js";
import { createOpenClawCodingTools } from "./agent-tools.js";

vi.mock("./channel-tools.js", () => {
  const passthrough = <T>(tool: T) => tool;
  const stubTool = (name: string) => ({
    name,
    description: `${name} stub`,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(),
  });
  return {
    listChannelAgentTools: () => [stubTool("plugin_login")],
    copyChannelAgentToolMeta: passthrough,
    getChannelAgentToolMeta: () => undefined,
  };
});

describe("tool availability", () => {
  it("keeps control-plane tools available", () => {
    const tools = createOpenClawCodingTools();
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("plugin_login");
    expect(toolNames).toContain("cron");
    expect(toolNames).toContain("gateway");
    expect(toolNames).toContain("nodes");
  });

  it("keeps canvas available by current trust model", () => {
    const tools = createOpenClawCodingTools();
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("canvas");
  });

  it("restricts node-originated runs to the node-safe tool subset", () => {
    const tools = createOpenClawCodingTools({ messageProvider: "node" });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("canvas");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("read");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("edit");
    expect(toolNames).not.toContain("message");
    expect(toolNames).not.toContain("sessions_send");
    expect(toolNames).not.toContain("subagents");
  });

  it("keeps issue #4 classifications on the assembled milestone tools that are present", () => {
    const tools = createOpenClawCodingTools();

    for (const toolName of ["exec", "gateway", "message", "web_fetch", "web_search"]) {
      const tool = tools.find((entry) => entry.name === toolName);
      if (tool) {
        expect(requireToolClassification(tool)).toMatchObject({ version: 1 });
      }
    }
  });
});
