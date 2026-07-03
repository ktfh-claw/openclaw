import { describe, expect, it } from "vitest";
import {
  applyEnforcementMetadataToMessage,
  normalizeEnforcementMetadata,
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
