import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { buildToolMutationState } from "../agents/tool-mutation.js";
import { normalizeTargetForProvider } from "../infra/outbound/target-normalization.js";
import { normalizeEnforcementMetadata, type EnforcementMetadata } from "./enforcement-metadata.js";
import type { ToolClassification } from "./tool-classification.js";

const MESSAGE_EXPLICIT_ROUTE_PATHS = new Set(["target", "targets", "channel", "channelId"]);

export type ToolEnforcementDecision =
  | {
      outcome: "allow";
      policyId?: "fides-untrusted-content-message-egress";
      audit?: ToolEnforcementAudit;
    }
  | {
      outcome: "deny";
      policyId: "fides-untrusted-content-message-egress";
      reason: string;
      audit: ToolEnforcementAudit;
    }
  | {
      outcome: "deny";
      policyId: "fides-untrusted-content-message-egress-ambiguous";
      reason: string;
      audit: ToolEnforcementAudit;
    };

export type ToolEnforcementAudit = Readonly<{
  policyId: "fides-untrusted-content-message-egress";
  consequential: string[];
  contentPaths: string[];
  destinationPaths: string[];
  provenanceTrust: "unknown" | "trusted" | "untrusted";
  provenanceSourceKind?: string;
  provenanceSourceLabel?: string;
  currentAudienceResolved: boolean;
  currentAudienceChannel?: string;
  currentAudienceThreaded: boolean;
}>;

type MessageAudienceContext = {
  turnSourceChannel?: string;
  turnSourceTo?: string;
  turnSourceThreadId?: string | number;
};

type ResolvedMessageAudience = {
  channel: string;
  to: string;
  threadId?: string;
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

function normalizeMessageAudienceContext(
  context: MessageAudienceContext | undefined,
): ResolvedMessageAudience | undefined {
  const channel = normalizeOptionalString(context?.turnSourceChannel);
  const to = normalizeOptionalString(context?.turnSourceTo);
  if (!channel || !to) {
    return undefined;
  }
  const threadId = normalizeOptionalString(
    context?.turnSourceThreadId == null ? undefined : String(context.turnSourceThreadId),
  );
  return {
    channel: channel.toLowerCase(),
    to: normalizeTargetForProvider(channel, to) ?? to,
    ...(threadId ? { threadId } : {}),
  };
}

function readExplicitRouteTargets(params: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const key of ["target", "to", "channelId"]) {
    const value = normalizeOptionalString(params[key]);
    if (value) {
      values.push(value);
    }
  }
  if (Array.isArray(params.targets)) {
    for (const value of params.targets) {
      const normalized = normalizeOptionalString(value);
      if (normalized) {
        values.push(normalized);
      }
    }
  }
  return values;
}

function hasExplicitReplyBroadening(
  params: Record<string, unknown>,
  current: ResolvedMessageAudience,
): boolean {
  if (!current.threadId) {
    return false;
  }
  if (params.topLevel === true || params.threadId === null) {
    return true;
  }
  const explicitThreadId = normalizeOptionalString(
    params.threadId == null ? undefined : String(params.threadId),
  );
  return Boolean(explicitThreadId && explicitThreadId !== current.threadId);
}

function resolveMessageAudienceDecision(args: {
  params: Record<string, unknown>;
  currentAudience?: ResolvedMessageAudience;
}): ToolEnforcementDecision {
  const channelHint =
    normalizeOptionalString(args.params.channel)?.toLowerCase() ?? args.currentAudience?.channel;
  const explicitTargets = readExplicitRouteTargets(args.params);
  if (explicitTargets.length > 1) {
    return {
      outcome: "deny",
      policyId: "fides-untrusted-content-message-egress",
      reason:
        "Blocked outbound message content because the tool call addresses multiple explicit destinations.",
    };
  }
  if (!args.currentAudience) {
    if (explicitTargets.length === 0 && !channelHint) {
      return {
        outcome: "deny",
        policyId: "fides-untrusted-content-message-egress-ambiguous",
        reason:
          "Blocked outbound message content because the current audience could not be resolved. Provide an explicit destination or reply from a routable source conversation.",
      };
    }
    return {
      outcome: "deny",
      policyId: "fides-untrusted-content-message-egress",
      reason:
        "Blocked outbound message content because the tool call routes to an explicit destination outside the current verified audience context.",
    };
  }
  if (hasExplicitReplyBroadening(args.params, args.currentAudience)) {
    return {
      outcome: "deny",
      policyId: "fides-untrusted-content-message-egress",
      reason:
        "Blocked outbound message content because the tool call broadens delivery beyond the current thread audience.",
    };
  }
  if (explicitTargets.length === 0) {
    return { outcome: "allow" };
  }
  if (channelHint && channelHint !== args.currentAudience.channel) {
    return {
      outcome: "deny",
      policyId: "fides-untrusted-content-message-egress",
      reason:
        "Blocked outbound message content because the tool call changes channel/provider away from the current audience.",
    };
  }
  const normalizedExplicitTarget =
    normalizeTargetForProvider(args.currentAudience.channel, explicitTargets[0]) ??
    explicitTargets[0];
  if (normalizedExplicitTarget === args.currentAudience.to) {
    return { outcome: "allow" };
  }
  return {
    outcome: "deny",
    policyId: "fides-untrusted-content-message-egress",
    reason:
      "Blocked outbound message content because the tool call targets a different audience than the current source conversation.",
  };
}

export function evaluateToolEnforcementPolicy(args: {
  toolName: string;
  params: unknown;
  classification?: ToolClassification;
  activeEnforcementMetadata?: EnforcementMetadata;
  messageAudience?: MessageAudienceContext;
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
  if (!hasClassifiedArgumentValue(paramsRecord, contentPaths)) {
    return { outcome: "allow" };
  }
  const normalizedAudience = normalizeMessageAudienceContext(args.messageAudience);
  const audit: ToolEnforcementAudit = {
    policyId: "fides-untrusted-content-message-egress",
    consequential: [...(args.classification?.consequential ?? [])],
    contentPaths,
    destinationPaths: explicitRoutePaths,
    provenanceTrust: metadata.provenance?.trust ?? "unknown",
    ...(metadata.provenance?.sourceKind
      ? { provenanceSourceKind: metadata.provenance.sourceKind }
      : {}),
    ...(metadata.provenance?.sourceLabel
      ? { provenanceSourceLabel: metadata.provenance.sourceLabel }
      : {}),
    currentAudienceResolved: Boolean(normalizedAudience),
    ...(normalizedAudience?.channel ? { currentAudienceChannel: normalizedAudience.channel } : {}),
    currentAudienceThreaded: Boolean(normalizedAudience?.threadId),
  };
  const baseDecision = resolveMessageAudienceDecision({
    params: paramsRecord,
    currentAudience: normalizedAudience,
  });
  if (baseDecision.outcome === "allow") {
    return {
      ...baseDecision,
      policyId: audit.policyId,
      audit,
    };
  }
  const sourceDescription =
    metadata.provenance?.sourceLabel ?? metadata.provenance?.sourceKind ?? "an untrusted source";
  return {
    ...baseDecision,
    reason: `${baseDecision.reason} Active provenance: ${sourceDescription}.`,
    audit,
  };
}
