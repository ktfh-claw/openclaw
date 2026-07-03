import { describe, expect, it } from "vitest";
import {
  isExternalHookSession,
  mapHookExternalContentSource,
  projectHookExternalContentSourceToEnforcementMetadata,
  resolveHookExternalContentSource,
} from "./external-content-source.js";

describe("external-content-source", () => {
  it("resolves known hook session provenance", () => {
    expect(resolveHookExternalContentSource("hook:gmail:msg-1")).toBe("gmail");
    expect(resolveHookExternalContentSource("hook:webhook:event-1")).toBe("webhook");
    expect(resolveHookExternalContentSource("hook:custom:event-1")).toBe("webhook");
    expect(resolveHookExternalContentSource("main")).toBeUndefined();
    expect(isExternalHookSession("hook:gmail:msg-1")).toBe(true);
    expect(isExternalHookSession("main")).toBe(false);
  });

  it("projects hook provenance into the shared enforcement metadata contract", () => {
    expect(mapHookExternalContentSource("gmail")).toBe("email");
    expect(projectHookExternalContentSourceToEnforcementMetadata("webhook")).toEqual({
      version: 1,
      provenance: {
        trust: "untrusted",
        sourceKind: "external_hook",
        sourceLabel: "webhook",
      },
    });
  });
});
