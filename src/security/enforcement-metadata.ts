// Minimal enforcement metadata carried beside content across OpenClaw-owned surfaces.
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import type { AgentMessage } from "../../packages/agent-core/src/types.js";

export const ENFORCEMENT_METADATA_VERSION = 1 as const;

export const ENFORCEMENT_METADATA_TRUST_VALUES = ["unknown", "trusted", "untrusted"] as const;

export type EnforcementMetadataTrust = (typeof ENFORCEMENT_METADATA_TRUST_VALUES)[number];

export const ENFORCEMENT_METADATA_SOURCE_KIND_VALUES = [
  "external_user",
  "external_hook",
  "inter_session",
  "tool_result",
  "internal_system",
  "unknown",
] as const;

export type EnforcementMetadataSourceKind =
  (typeof ENFORCEMENT_METADATA_SOURCE_KIND_VALUES)[number];

export const ENFORCEMENT_METADATA_AUDIENCE_SCOPE_VALUES = ["current_session", "named"] as const;

export type EnforcementMetadataAudienceScope =
  (typeof ENFORCEMENT_METADATA_AUDIENCE_SCOPE_VALUES)[number];

export type EnforcementMetadataProvenance = {
  trust: EnforcementMetadataTrust;
  sourceKind?: EnforcementMetadataSourceKind;
  sourceLabel?: string;
};

export type EnforcementMetadataAudience = {
  scope: EnforcementMetadataAudienceScope;
  label?: string;
};

export type EnforcementMetadata = {
  version: typeof ENFORCEMENT_METADATA_VERSION;
  provenance?: EnforcementMetadataProvenance;
  audience?: EnforcementMetadataAudience;
};

const ENFORCEMENT_METADATA_LABEL_MAX_CHARS = 256;
const ENFORCEMENT_METADATA_PROMPT_PREFIX_BASE = "[Untrusted content provenance]";
const ENFORCEMENT_METADATA_PROMPT_PREFIX_RE = /^\[Untrusted content provenance\][^\n]*(?:\n)?/;

function normalizeEnforcementMetadataLabel(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, ENFORCEMENT_METADATA_LABEL_MAX_CHARS);
}

function isEnforcementMetadataTrust(value: unknown): value is EnforcementMetadataTrust {
  return (
    typeof value === "string" &&
    (ENFORCEMENT_METADATA_TRUST_VALUES as readonly string[]).includes(value)
  );
}

function isEnforcementMetadataSourceKind(value: unknown): value is EnforcementMetadataSourceKind {
  return (
    typeof value === "string" &&
    (ENFORCEMENT_METADATA_SOURCE_KIND_VALUES as readonly string[]).includes(value)
  );
}

function isEnforcementMetadataAudienceScope(
  value: unknown,
): value is EnforcementMetadataAudienceScope {
  return (
    typeof value === "string" &&
    (ENFORCEMENT_METADATA_AUDIENCE_SCOPE_VALUES as readonly string[]).includes(value)
  );
}

export function normalizeEnforcementMetadataProvenance(
  value: unknown,
): EnforcementMetadataProvenance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isEnforcementMetadataTrust(record.trust)) {
    return undefined;
  }
  const sourceKind = isEnforcementMetadataSourceKind(record.sourceKind)
    ? record.sourceKind
    : undefined;
  const sourceLabel = normalizeEnforcementMetadataLabel(record.sourceLabel);
  return {
    trust: record.trust,
    ...(sourceKind ? { sourceKind } : {}),
    ...(sourceLabel ? { sourceLabel } : {}),
  };
}

export function normalizeEnforcementMetadataAudience(
  value: unknown,
): EnforcementMetadataAudience | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isEnforcementMetadataAudienceScope(record.scope)) {
    return undefined;
  }
  const label = normalizeEnforcementMetadataLabel(record.label);
  return {
    scope: record.scope,
    ...(label ? { label } : {}),
  };
}

export function normalizeEnforcementMetadata(value: unknown): EnforcementMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const version =
    record.version === undefined
      ? ENFORCEMENT_METADATA_VERSION
      : record.version === ENFORCEMENT_METADATA_VERSION
        ? ENFORCEMENT_METADATA_VERSION
        : undefined;
  if (!version) {
    return undefined;
  }
  const provenance = normalizeEnforcementMetadataProvenance(record.provenance);
  const audience = normalizeEnforcementMetadataAudience(record.audience);
  if (!provenance && !audience) {
    return undefined;
  }
  return {
    version,
    ...(provenance ? { provenance } : {}),
    ...(audience ? { audience } : {}),
  };
}

export function applyEnforcementMetadataToMessage(
  message: AgentMessage,
  metadata: EnforcementMetadata | undefined,
): AgentMessage {
  if (!metadata) {
    return message;
  }
  const existing = normalizeEnforcementMetadata(
    (message as { enforcementMetadata?: unknown }).enforcementMetadata,
  );
  if (existing) {
    return message;
  }
  return {
    ...(message as unknown as Record<string, unknown>),
    enforcementMetadata: metadata,
  } as AgentMessage;
}

function enforcementMetadataTrustPrecedence(value: EnforcementMetadataTrust | undefined): number {
  switch (value) {
    case "untrusted":
      return 3;
    case "unknown":
      return 2;
    case "trusted":
      return 1;
    default:
      return 0;
  }
}

function buildEnforcementMetadataPromptPrefix(metadata: EnforcementMetadata): string | undefined {
  const provenance = metadata.provenance;
  if (!provenance || provenance.trust !== "untrusted") {
    return undefined;
  }
  const details = [
    provenance.sourceKind ? `sourceKind=${provenance.sourceKind}` : undefined,
    provenance.sourceLabel ? `source=${provenance.sourceLabel}` : undefined,
  ].filter(Boolean);
  return details.length > 0
    ? `${ENFORCEMENT_METADATA_PROMPT_PREFIX_BASE} ${details.join(" ")}`
    : ENFORCEMENT_METADATA_PROMPT_PREFIX_BASE;
}

function removeEnforcementMetadataPromptPrefix(text: string): string {
  return text.replace(ENFORCEMENT_METADATA_PROMPT_PREFIX_RE, "").trimStart();
}

export function annotateTextWithEnforcementMetadata(
  text: string,
  metadata: EnforcementMetadata | undefined,
): string {
  const normalized = normalizeEnforcementMetadata(metadata);
  const prefix = normalized ? buildEnforcementMetadataPromptPrefix(normalized) : undefined;
  if (!prefix || !text.trim()) {
    return text;
  }
  if (text === prefix || text.startsWith(`${prefix}\n`)) {
    return text;
  }
  const body = removeEnforcementMetadataPromptPrefix(text);
  return `${prefix}\n${body}`;
}

export function readEnforcementMetadataFromMessage(
  message:
    | {
        enforcementMetadata?: unknown;
        details?: unknown;
      }
    | undefined,
): EnforcementMetadata | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const direct = normalizeEnforcementMetadata(message.enforcementMetadata);
  if (direct) {
    return direct;
  }
  const details =
    message.details && typeof message.details === "object" && !Array.isArray(message.details)
      ? (message.details as Record<string, unknown>)
      : undefined;
  return normalizeEnforcementMetadata(details?.enforcementMetadata);
}

export function mergeEnforcementMetadata(
  values: Iterable<EnforcementMetadata | undefined>,
): EnforcementMetadata | undefined {
  let best: EnforcementMetadata | undefined;
  for (const value of values) {
    const normalized = normalizeEnforcementMetadata(value);
    if (!normalized) {
      continue;
    }
    if (!best) {
      best = normalized;
      continue;
    }
    const bestTrust = enforcementMetadataTrustPrecedence(best.provenance?.trust);
    const nextTrust = enforcementMetadataTrustPrecedence(normalized.provenance?.trust);
    if (nextTrust > bestTrust) {
      best = normalized;
      continue;
    }
    if (nextTrust === bestTrust) {
      best = {
        version: ENFORCEMENT_METADATA_VERSION,
        ...(best.provenance || normalized.provenance
          ? {
              provenance: {
                ...(best.provenance ?? normalized.provenance ?? {}),
                ...(best.provenance?.sourceKind
                  ? {}
                  : normalized.provenance?.sourceKind
                    ? { sourceKind: normalized.provenance.sourceKind }
                    : {}),
                ...(best.provenance?.sourceLabel
                  ? {}
                  : normalized.provenance?.sourceLabel
                    ? { sourceLabel: normalized.provenance.sourceLabel }
                    : {}),
              },
            }
          : {}),
        ...(best.audience
          ? { audience: best.audience }
          : normalized.audience
            ? { audience: normalized.audience }
            : {}),
      };
    }
  }
  return best;
}

export function deriveActiveEnforcementMetadataFromMessages(
  messages: Iterable<{
    enforcementMetadata?: unknown;
    details?: unknown;
  }>,
): EnforcementMetadata | undefined {
  return mergeEnforcementMetadata(
    Array.from(messages, (message) => readEnforcementMetadataFromMessage(message)),
  );
}
