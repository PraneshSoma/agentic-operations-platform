import { describe, it, expect } from "vitest";
import { DEFAULT_APPROVER_PRINCIPAL, parseUserMap, resolvePrincipal } from "./principal-map.js";

describe("principal-map", () => {
  it("parses a well-formed map and trims whitespace", () => {
    const m = parseUserMap(" U1 : riley-lead , U2:sam-oncall ");
    expect(m.get("U1")).toBe("riley-lead");
    expect(m.get("U2")).toBe("sam-oncall");
  });

  it("returns an empty map for undefined or empty input", () => {
    expect(parseUserMap(undefined).size).toBe(0);
    expect(parseUserMap("").size).toBe(0);
  });

  it("skips malformed entries", () => {
    const m = parseUserMap("U1:riley-lead,garbage,:nobody,U3:");
    expect(m.size).toBe(1);
    expect(m.get("U1")).toBe("riley-lead");
  });

  it("resolves a mapped user to its principal", () => {
    const m = parseUserMap("U1:sam-oncall");
    expect(resolvePrincipal("U1", m)).toBe("sam-oncall");
  });

  it("falls back to the default approver for an unmapped user", () => {
    expect(resolvePrincipal("Uzzz", new Map())).toBe(DEFAULT_APPROVER_PRINCIPAL);
  });

  it("honors a custom fallback", () => {
    expect(resolvePrincipal("Uzzz", new Map(), "custom")).toBe("custom");
  });
});
