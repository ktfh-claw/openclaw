import { describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../agents/tools/common.js";
import {
  annotateMilestoneToolClassifications,
  getToolClassification,
  normalizeToolClassification,
  requireToolClassification,
  setToolClassification,
  testing,
  TOOL_CLASSIFICATION_VERSION,
} from "./tool-classification.js";

function createStubTool(name: string): AnyAgentTool {
  return {
    name,
    description: `${name} stub`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [] }),
  } as AnyAgentTool;
}

describe("tool-classification", () => {
  it("annotates the issue #4 milestone tool set with validated metadata", () => {
    const tools = Object.keys(testing.MILESTONE_TOOL_CLASSIFICATIONS).map(createStubTool);

    annotateMilestoneToolClassifications(tools);

    for (const tool of tools) {
      const classification = requireToolClassification(tool);
      expect(classification.version).toBe(TOOL_CLASSIFICATION_VERSION);
      expect(
        classification.consequential ||
          classification.untrustedContentSource ||
          classification.egressArguments,
      ).toBeTruthy();
    }

    expect(requireToolClassification(tools.find((tool) => tool.name === "message")!)).toMatchObject(
      {
        consequential: ["network_egress"],
      },
    );
    expect(
      requireToolClassification(tools.find((tool) => tool.name === "web_fetch")!),
    ).toMatchObject({
      untrustedContentSource: ["network_response"],
    });
    expect(requireToolClassification(tools.find((tool) => tool.name === "browser")!)).toMatchObject(
      {
        consequential: ["network_egress", "remote_control"],
        untrustedContentSource: ["browser_page"],
      },
    );
    expect(
      requireToolClassification(tools.find((tool) => tool.name === "file_fetch")!),
    ).toMatchObject({
      consequential: ["remote_file_access"],
      untrustedContentSource: ["remote_file"],
    });
  });

  it("treats missing classification as an error at the assertion seam", () => {
    expect(() => requireToolClassification(createStubTool("unclassified"))).toThrow(
      'Missing tool classification metadata for tool "unclassified"',
    );
  });

  it("rejects malformed classification metadata", () => {
    const tool = createStubTool("message");

    expect(
      normalizeToolClassification({
        version: TOOL_CLASSIFICATION_VERSION,
        consequential: ["not-a-real-kind"],
      }),
    ).toBeUndefined();
    expect(() =>
      setToolClassification(tool, {
        version: TOOL_CLASSIFICATION_VERSION,
        egressArguments: [{ path: "", kind: "content" }],
      }),
    ).toThrow('Invalid tool classification metadata for tool "message"');
    expect(getToolClassification(tool)).toBeUndefined();
  });
});
