import { describe, expect, it } from "vitest";
import {
  annotateTextWithEnforcementMetadata,
  applyEnforcementMetadataToMessage,
  deriveActiveEnforcementMetadataFromMessages,
  mergeEnforcementMetadata,
  normalizeEnforcementMetadata,
  readEnforcementMetadataFromMessage,
} from "./enforcement-metadata.js";

describe("normalizeEnforcementMetadata", () => {
  it("normalizes minimal provenance and audience metadata", () => {
    expect(
      normalizeEnforcementMetadata({
        provenance: {
          trust: "untrusted",
          sourceKind: "external_user",
          sourceLabel: "  discord  ",
        },
        audience: {
          scope: "current_session",
          label: "  agent:main:discord:dm:user-1  ",
        },
      }),
    ).toEqual({
      version: 1,
      provenance: {
        trust: "untrusted",
        sourceKind: "external_user",
        sourceLabel: "discord",
      },
      audience: {
        scope: "current_session",
        label: "agent:main:discord:dm:user-1",
      },
    });
  });

  it("drops invalid metadata and rejects unsupported versions", () => {
    expect(
      normalizeEnforcementMetadata({
        version: 2,
        provenance: { trust: "untrusted" },
      }),
    ).toBeUndefined();
    expect(
      normalizeEnforcementMetadata({
        provenance: { trust: "not-real" },
      }),
    ).toBeUndefined();
  });

  it("keeps normalized metadata stable across JSON round-trips", () => {
    const metadata = normalizeEnforcementMetadata({
      provenance: {
        trust: "trusted",
        sourceKind: "internal_system",
        sourceLabel: "runtime",
      },
    });

    expect(normalizeEnforcementMetadata(JSON.parse(JSON.stringify(metadata)))).toEqual(metadata);
  });
});

describe("applyEnforcementMetadataToMessage", () => {
  it("attaches metadata once and preserves existing metadata", () => {
    const metadata = normalizeEnforcementMetadata({
      provenance: { trust: "untrusted", sourceKind: "tool_result", sourceLabel: "web_fetch" },
    });
    if (!metadata) {
      throw new Error("expected normalized metadata");
    }

    const message = applyEnforcementMetadataToMessage(
      { role: "user", content: "forward this" },
      metadata,
    ) as { enforcementMetadata?: unknown };
    expect(message.enforcementMetadata).toEqual(metadata);

    const existing = applyEnforcementMetadataToMessage(
      {
        role: "user",
        content: "forward this",
        enforcementMetadata: {
          version: 1,
          provenance: { trust: "trusted", sourceKind: "internal_system", sourceLabel: "system" },
        },
      },
      metadata,
    ) as { enforcementMetadata?: unknown };

    expect(existing.enforcementMetadata).toEqual({
      version: 1,
      provenance: { trust: "trusted", sourceKind: "internal_system", sourceLabel: "system" },
    });
  });
});

describe("enforcement metadata replay helpers", () => {
  it("reads metadata from compaction-style details carriers", () => {
    expect(
      readEnforcementMetadataFromMessage({
        details: {
          enforcementMetadata: {
            version: 1,
            provenance: { trust: "untrusted", sourceKind: "external_user", sourceLabel: "discord" },
          },
        },
      }),
    ).toEqual({
      version: 1,
      provenance: { trust: "untrusted", sourceKind: "external_user", sourceLabel: "discord" },
    });
  });

  it("keeps untrusted trust sticky when merging replay carriers", () => {
    expect(
      mergeEnforcementMetadata([
        {
          version: 1,
          provenance: { trust: "trusted", sourceKind: "internal_system", sourceLabel: "runtime" },
        },
        {
          version: 1,
          provenance: { trust: "untrusted", sourceKind: "external_user", sourceLabel: "discord" },
        },
      ]),
    ).toEqual({
      version: 1,
      provenance: { trust: "untrusted", sourceKind: "external_user", sourceLabel: "discord" },
    });
  });

  it("derives active metadata from user turns and compacted summary carriers", () => {
    expect(
      deriveActiveEnforcementMetadataFromMessages([
        {
          role: "compactionSummary",
          details: {
            enforcementMetadata: {
              version: 1,
              provenance: {
                trust: "untrusted",
                sourceKind: "external_user",
                sourceLabel: "discord",
              },
            },
          },
        },
        {
          role: "user",
          enforcementMetadata: {
            version: 1,
            provenance: { trust: "trusted", sourceKind: "internal_system", sourceLabel: "runtime" },
          },
        },
      ]),
    ).toEqual({
      version: 1,
      provenance: { trust: "untrusted", sourceKind: "external_user", sourceLabel: "discord" },
    });
  });

  it("adds an idempotent model-visible prefix for untrusted replay text", () => {
    const metadata = {
      version: 1 as const,
      provenance: { trust: "untrusted" as const, sourceKind: "external_user" as const },
    };
    const once = annotateTextWithEnforcementMetadata("Historical ask", metadata);
    const twice = annotateTextWithEnforcementMetadata(once, metadata);
    expect(once).toBe("[Untrusted content provenance] sourceKind=external_user\nHistorical ask");
    expect(twice).toBe(once);
  });
});
