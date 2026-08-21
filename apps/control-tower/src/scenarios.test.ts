import { describe, it, expect } from "vitest";
import { SCENARIOS, scenarioByKey, scenarioByScene, scenarioKeyFromText } from "./scenarios.js";

describe("scenarios", () => {
  it("has one live P1 plus ten lab incidents, with one approval gate", () => {
    expect(SCENARIOS).toHaveLength(11);
    expect(SCENARIOS.filter((s) => s.hasApprovalGate).map((s) => s.scene)).toEqual([1]);
  });

  it("looks up by key and by scene, undefined when missing", () => {
    expect(scenarioByKey("hot-key")?.scene).toBe(3);
    expect(scenarioByKey("nope")).toBeUndefined();
    expect(scenarioByScene(11)?.key).toBe("reconciliation-drift");
    expect(scenarioByScene(99)).toBeUndefined();
  });

  describe("scenarioKeyFromText", () => {
    it("matches an explicit 'scene N'", () => {
      expect(scenarioKeyFromText("run scene 4 please")).toBe("stale-kyc");
    });
    it("matches a bare digit", () => {
      expect(scenarioKeyFromText("do 5")).toBe("cache-penetration");
    });
    it("matches a scenario key keyword", () => {
      expect(scenarioKeyFromText("try the retry storm")).toBe("retry-storm");
    });
    it("falls back to the happy path when nothing matches", () => {
      expect(scenarioKeyFromText("hey there is an incident")).toBe("happy-path");
    });
    it("ignores a digit that maps to no scene and falls through to a keyword", () => {
      expect(scenarioKeyFromText("scene 42 hot key")).toBe("hot-key");
    });
    it("falls through to default when a bad digit matches nothing else", () => {
      expect(scenarioKeyFromText("code 42")).toBe("happy-path");
    });
  });
});
