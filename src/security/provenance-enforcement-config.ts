import type { OpenClawConfig } from "../config/types.openclaw.js";

export type ProvenanceEnforcementAuditMode = "off" | "blocked" | "all";

export type ResolvedProvenanceEnforcementConfig = Readonly<{
  enabled: boolean;
  audit: ProvenanceEnforcementAuditMode;
}>;

export function resolveProvenanceEnforcementConfig(
  cfg?: OpenClawConfig,
): ResolvedProvenanceEnforcementConfig {
  return {
    enabled: cfg?.security?.provenanceEnforcement?.enabled !== false,
    audit: cfg?.security?.provenanceEnforcement?.audit ?? "blocked",
  };
}

export function shouldAuditProvenanceDecision(
  cfg: ResolvedProvenanceEnforcementConfig,
  outcome: "allow" | "deny",
): boolean {
  if (cfg.audit === "off") {
    return false;
  }
  if (cfg.audit === "all") {
    return true;
  }
  return outcome === "deny";
}
