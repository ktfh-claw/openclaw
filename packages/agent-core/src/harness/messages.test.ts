// Agent Core tests cover messages behavior.
import { describe, expect, it } from "vitest";
import { convertToLlm, createCompactionSummaryMessage, createCustomMessage } from "./messages.js";

describe("harness message timestamps", () => {
  it("rejects invalid timestamps before creating context messages", () => {
    expect(() => createCustomMessage("note", "content", true, {}, "not-a-date")).toThrow(
      "custom message timestamp must be a valid timestamp",
    );
  });
  it("normalizes persisted compaction summary timestamp strings", () => {
    const timestamp = "2026-05-30T17:00:00.000Z";
    const persistedMessages: Parameters<typeof convertToLlm>[0] = [
      {
        role: "compactionSummary",
        summary: "older context",
        tokensBefore: 123,
        timestamp,
        details: { enforcementMetadata: { version: 1, provenance: { trust: "untrusted" } } },
      },
    ];

    const [message] = convertToLlm(persistedMessages);

    expect(message?.timestamp).toBe(Date.parse(timestamp));
  });

  it("preserves compaction summary details for replay-side metadata consumers", () => {
    const created = createCompactionSummaryMessage(
      "older context",
      123,
      "2026-05-30T17:00:00.000Z",
      {
        enforcementMetadata: { version: 1, provenance: { trust: "untrusted" } },
      },
    );

    expect(created.details).toEqual({
      enforcementMetadata: { version: 1, provenance: { trust: "untrusted" } },
    });
  });

  it("keeps corrupt persisted compaction timestamps non-fatal", () => {
    const persistedMessages: Parameters<typeof convertToLlm>[0] = [
      {
        role: "compactionSummary",
        summary: "older context",
        tokensBefore: 123,
        timestamp: "not a timestamp",
      },
    ];

    const [message] = convertToLlm(persistedMessages);

    expect(message?.timestamp).toBe(0);
  });
});
