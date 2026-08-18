import { describe, expect, it } from "vitest";
import type { PolicyRule } from "@aop/contracts";
import { ruleMatches } from "./rule-matching.js";

function rule(overrides: Partial<PolicyRule["when"]> = {}): PolicyRule {
  return { rule_id: "r1", when: overrides, decision: "ALLOW", immutable: false };
}

describe("ruleMatches", () => {
  it("matches when `when` is empty — no constraint on any dimension", () => {
    expect(ruleMatches(rule({}), "prod", "R2")).toBe(true);
  });

  it("matches on environment when specified and equal", () => {
    expect(ruleMatches(rule({ environment: "prod" }), "prod", "R2")).toBe(true);
  });

  it("does not match on environment when specified and different", () => {
    expect(ruleMatches(rule({ environment: "prod" }), "dev", "R2")).toBe(false);
  });

  it("matches on risk_class_in when the effective risk class is included", () => {
    expect(ruleMatches(rule({ risk_class_in: ["R2", "R3"] }), "prod", "R2")).toBe(true);
  });

  it("does not match on risk_class_in when the effective risk class is excluded", () => {
    expect(ruleMatches(rule({ risk_class_in: ["R2", "R3"] }), "prod", "R0")).toBe(false);
  });

  it("requires ALL specified dimensions to match", () => {
    const r = rule({ environment: "prod", risk_class_in: ["R2", "R3"] });
    expect(ruleMatches(r, "prod", "R2")).toBe(true);
    expect(ruleMatches(r, "dev", "R2")).toBe(false);
    expect(ruleMatches(r, "prod", "R0")).toBe(false);
  });
});
