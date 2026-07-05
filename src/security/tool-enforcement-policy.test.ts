import { describe, expect, it } from "vitest";
import { evaluateToolEnforcementPolicy } from "./tool-enforcement-policy.js";

describe("evaluateToolEnforcementPolicy", () => {
  const classification = {
    version: 1 as const,
    consequential: ["network_egress"] as const,
    egressArguments: [
      { path: "message", kind: "content" as const },
      { path: "target", kind: "destination" as const },
      { path: "channel", kind: "destination" as const },
    ],
  };

  it("blocks explicit outbound message sends from untrusted content", () => {
    expect(
      evaluateToolEnforcementPolicy({
        toolName: "message",
        params: { action: "send", target: "user:42", message: "forward this" },
        classification,
        activeEnforcementMetadata: {
          version: 1,
          provenance: {
            trust: "untrusted",
            sourceKind: "external_user",
            sourceLabel: "discord",
          },
        },
      }),
    ).toMatchObject({
      outcome: "deny",
      policyId: "fides-untrusted-content-message-egress",
    });
  });

  it("allows untrusted current-session replies without explicit outbound routing", () => {
    expect(
      evaluateToolEnforcementPolicy({
        toolName: "message",
        params: { action: "send", message: "safe local reply" },
        classification,
        activeEnforcementMetadata: {
          version: 1,
          provenance: {
            trust: "untrusted",
            sourceKind: "external_user",
          },
        },
      }),
    ).toEqual({ outcome: "allow" });
  });

  it("allows trusted content even with explicit routing", () => {
    expect(
      evaluateToolEnforcementPolicy({
        toolName: "message",
        params: { action: "send", target: "user:42", message: "system notice" },
        classification,
        activeEnforcementMetadata: {
          version: 1,
          provenance: {
            trust: "trusted",
            sourceKind: "internal_system",
          },
        },
      }),
    ).toEqual({ outcome: "allow" });
  });

  it("ignores read-only message actions", () => {
    expect(
      evaluateToolEnforcementPolicy({
        toolName: "message",
        params: { action: "read", target: "user:42", message: "ignored" },
        classification,
        activeEnforcementMetadata: {
          version: 1,
          provenance: {
            trust: "untrusted",
            sourceKind: "external_user",
          },
        },
      }),
    ).toEqual({ outcome: "allow" });
  });
});
