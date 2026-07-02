import { afterEach, describe, expect, it, vi } from "vitest";
import { redactConfiguredToolResult } from "./tool-result-redaction.js";

vi.mock("../logging/config.js", () => ({
  readLoggingConfig: vi.fn(),
}));

import { readLoggingConfig } from "../logging/config.js";

const mockedReadLoggingConfig = vi.mocked(readLoggingConfig);

describe("redactConfiguredToolResult", () => {
  afterEach(() => {
    mockedReadLoggingConfig.mockReset();
  });

  it("leaves tool results unchanged when tool redaction is disabled", () => {
    mockedReadLoggingConfig.mockReturnValue({
      redactSensitive: "off",
      redactPatterns: ["secret-[0-9]+"],
    });

    const result = {
      content: [{ type: "text" as const, text: "secret-123" }],
      details: { value: "secret-123" },
    };

    expect(redactConfiguredToolResult(result)).toBe(result);
  });

  it("replaces configured matches in text content and details with REDACTED", () => {
    mockedReadLoggingConfig.mockReturnValue({
      redactSensitive: "tools",
      redactPatterns: [String.raw`secret-[0-9]+`, String.raw`alpha[a-z]+`],
    });

    const result = {
      content: [
        { type: "text" as const, text: "before secret-123 after alphabeta" },
        { type: "image" as const, mimeType: "image/png", data: "abc" },
      ],
      details: {
        nested: ["secret-456", { note: "alphaomega" }],
        untouchedNumber: 7,
      },
    };

    expect(redactConfiguredToolResult(result)).toEqual({
      content: [
        { type: "text", text: "before REDACTED after REDACTED" },
        { type: "image", mimeType: "image/png", data: "abc" },
      ],
      details: {
        nested: ["REDACTED", { note: "REDACTED" }],
        untouchedNumber: 7,
      },
    });
  });

  it("ignores rejected regex patterns and keeps safe ones", () => {
    mockedReadLoggingConfig.mockReturnValue({
      redactSensitive: "tools",
      redactPatterns: ["(", String.raw`keepme-[0-9]+`],
    });

    const result = {
      content: [{ type: "text" as const, text: "keepme-42 and visible" }],
      details: undefined,
    };

    expect(redactConfiguredToolResult(result)).toEqual({
      content: [{ type: "text", text: "REDACTED and visible" }],
      details: undefined,
    });
  });
});
