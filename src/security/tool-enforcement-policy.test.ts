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
        messageAudience: {
          turnSourceChannel: "slack",
          turnSourceTo: "user:99",
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
        messageAudience: {
          turnSourceChannel: "slack",
          turnSourceTo: "user:42",
        },
      }),
    ).toMatchObject({
      outcome: "allow",
      policyId: "fides-untrusted-content-message-egress",
      audit: {
        provenanceTrust: "untrusted",
        currentAudienceResolved: true,
      },
    });
  });

  it("allows explicit sends when they stay within the current audience", () => {
    expect(
      evaluateToolEnforcementPolicy({
        toolName: "message",
        params: { action: "send", target: "user:42", message: "reply in place" },
        classification,
        activeEnforcementMetadata: {
          version: 1,
          provenance: {
            trust: "untrusted",
            sourceKind: "external_user",
          },
        },
        messageAudience: {
          turnSourceChannel: "slack",
          turnSourceTo: "user:42",
        },
      }),
    ).toMatchObject({
      outcome: "allow",
      policyId: "fides-untrusted-content-message-egress",
      audit: {
        currentAudienceResolved: true,
      },
    });
  });

  it("blocks thread-broadening sends from untrusted content", () => {
    expect(
      evaluateToolEnforcementPolicy({
        toolName: "message",
        params: { action: "send", target: "channel:C1", topLevel: true, message: "widen this" },
        classification,
        activeEnforcementMetadata: {
          version: 1,
          provenance: {
            trust: "untrusted",
            sourceKind: "external_user",
          },
        },
        messageAudience: {
          turnSourceChannel: "slack",
          turnSourceTo: "channel:C1",
          turnSourceThreadId: "111.222",
        },
      }),
    ).toMatchObject({
      outcome: "deny",
      policyId: "fides-untrusted-content-message-egress",
    });
  });

  it("fails closed when the current audience cannot be resolved", () => {
    expect(
      evaluateToolEnforcementPolicy({
        toolName: "message",
        params: { action: "send", message: "where does this go?" },
        classification,
        activeEnforcementMetadata: {
          version: 1,
          provenance: {
            trust: "untrusted",
            sourceKind: "external_user",
          },
        },
      }),
    ).toMatchObject({
      outcome: "deny",
      policyId: "fides-untrusted-content-message-egress-ambiguous",
    });
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
