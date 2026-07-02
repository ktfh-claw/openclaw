import { readLoggingConfig } from "../logging/config.js";
import { replacePatternBounded } from "../logging/redact-bounded.js";
import { compileConfigRegex } from "../security/config-regex.js";
import type { AgentToolResult } from "./runtime/index.js";

type ToolResultContentBlock = AgentToolResult["content"][number];

const SKILL_OUTPUT_REDACTION = "REDACTED";
const TOOL_REDACT_FLAGS = "gu";

function getConfiguredToolRedactionPatterns(): RegExp[] {
  const logging = readLoggingConfig();
  if (logging?.redactSensitive !== "tools" || !Array.isArray(logging.redactPatterns)) {
    return [];
  }
  const patterns: RegExp[] = [];
  for (const pattern of logging.redactPatterns) {
    if (typeof pattern !== "string") {
      continue;
    }
    const compiled = compileConfigRegex(pattern, TOOL_REDACT_FLAGS);
    if (compiled?.regex) {
      patterns.push(compiled.regex);
    }
  }
  return patterns;
}

function redactConfiguredText(text: string, patterns: readonly RegExp[]): string {
  let next = text;
  for (const pattern of patterns) {
    next = replacePatternBounded(next, pattern, SKILL_OUTPUT_REDACTION);
  }
  return next;
}

function redactDetailsValue(value: unknown, patterns: readonly RegExp[]): unknown {
  if (typeof value === "string") {
    return redactConfiguredText(value, patterns);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDetailsValue(entry, patterns));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = redactDetailsValue(entry, patterns);
  }
  return next;
}

function redactContentBlock(
  block: ToolResultContentBlock,
  patterns: readonly RegExp[],
): ToolResultContentBlock {
  if (block.type !== "text") {
    return block;
  }
  return {
    ...block,
    text: redactConfiguredText(block.text, patterns),
  };
}

export function redactConfiguredToolResult<TDetails = unknown>(
  result: AgentToolResult<TDetails>,
): AgentToolResult<TDetails> {
  const patterns = getConfiguredToolRedactionPatterns();
  if (patterns.length === 0) {
    return result;
  }
  return {
    ...result,
    content: result.content.map((block) => redactContentBlock(block, patterns)),
    details: redactDetailsValue(result.details, patterns) as TDetails,
  };
}
