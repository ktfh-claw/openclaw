import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { buildToolMutationState } from "../agents/tool-mutation.js";
import { normalizeEnforcementMetadata, type EnforcementMetadata } from "./enforcement-metadata.js";
import type { ToolClassification } from "./tool-classification.js";

const MESSAGE_EXPLICIT_ROUTE_PATHS = new Set(["target", "targets", "channel", "channelId"]);

export type ToolEnforcementDecision =
  | {
      outcome: "allow";
    }
  | {
      outcome: "deny";
      policyId: "fides-untrusted-content-message-egress";
      reason: string;
    };

function readPathValue(record: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = record;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function hasMeaningfulArgumentValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulArgumentValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return false;
}

function hasClassifiedArgumentValue(
  params: Record<string, unknown>,
  paths: readonly string[],
): boolean {
  return paths.some((path) => hasMeaningfulArgumentValue(readPathValue(params, path)));
}

export function evaluateToolEnforcementPolicy(args: {
  toolName: string;
  params: unknown;
  classification?: ToolClassification;
  activeEnforcementMetadata?: EnforcementMetadata;
}): ToolEnforcementDecision {
  const metadata = normalizeEnforcementMetadata(args.activeEnforcementMetadata);
  if (metadata?.provenance?.trust !== "untrusted") {
    return { outcome: "allow" };
  }
  if (normalizeOptionalString(args.toolName)?.toLowerCase() !== "message") {
    return { outcome: "allow" };
  }
  const paramsRecord =
    args.params && typeof args.params === "object" && !Array.isArray(args.params)
      ? (args.params as Record<string, unknown>)
      : {};
  if (!buildToolMutationState("message", paramsRecord).mutatingAction) {
    return { outcome: "allow" };
  }
  const egressArguments = args.classification?.egressArguments;
  if (!egressArguments?.length) {
    return { outcome: "allow" };
  }
  const contentPaths = egressArguments
    .filter((entry) => entry.kind === "content")
    .map((entry) => entry.path);
  const explicitRoutePaths = egressArguments
    .filter((entry) => entry.kind === "destination" && MESSAGE_EXPLICIT_ROUTE_PATHS.has(entry.path))
    .map((entry) => entry.path);
  if (contentPaths.length === 0 || explicitRoutePaths.length === 0) {
    return { outcome: "allow" };
  }
  if (
    !hasClassifiedArgumentValue(paramsRecord, contentPaths) ||
    !hasClassifiedArgumentValue(paramsRecord, explicitRoutePaths)
  ) {
    return { outcome: "allow" };
  }
  const sourceDescription =
    metadata.provenance?.sourceLabel ?? metadata.provenance?.sourceKind ?? "an untrusted source";
  return {
    outcome: "deny",
    policyId: "fides-untrusted-content-message-egress",
    reason:
      `Blocked outbound message content because the active request is marked untrusted ` +
      `(${sourceDescription}) and the tool call targets an explicit external destination.`,
  };
}
