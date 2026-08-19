import { describe, it, expect } from "vitest";
import { SCENARIOS, scenarioByKey, scenarioByScene, scenarioKeyFromText } from "./scenarios.js";

describe("scenarios", () => {
  it("has exactly six scenes, one gate on the happy path", () => {
    expect(SCENARIOS).toHaveLength(6);
    expect(SCENARIOS.filter((s) => s.hasApprovalGate).map((s) => s.scene)).toEqual([1]);
  });

  it("looks up by key and by scene, undefined when missing", () => {
    expect(scenarioByKey("frozen-plan")?.scene).toBe(3);
    expect(scenarioByKey("nope")).toBeUndefined();
    expect(scenarioByScene(6)?.key).toBe("budget");
    expect(scenarioByScene(99)).toBeUndefined();
  });

  describe("scenarioKeyFromText", () => {
    it("matches an explicit 'scene N'", () => {
      expect(scenarioKeyFromText("run scene 4 please")).toBe("preflight-drift");
    });
    it("matches a bare digit", () => {
      expect(scenarioKeyFromText("do 5")).toBe("emergency-halt");
    });
    it("matches a scenario key keyword", () => {
      expect(scenarioKeyFromText("try the ambiguous ticket")).toBe("ambiguous");
    });
    it("falls back to the happy path when nothing matches", () => {
      expect(scenarioKeyFromText("hey there is an incident")).toBe("happy-path");
    });
    it("ignores a digit that maps to no scene and falls through to a keyword", () => {
      expect(scenarioKeyFromText("scene 9 budget blowout")).toBe("budget");
    });
    it("falls through to default when a bad digit matches nothing else", () => {
      expect(scenarioKeyFromText("code 42")).toBe("happy-path");
    });
  });
});
