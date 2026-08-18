import { describe, expect, it } from "vitest";
import { PolicyRuleSchema } from "./policy-rule.js";

const validPayload = {
  rule_id: "PROD_R2_APPROVAL",
  when: { environment: "prod", risk_class_in: ["R2", "R3"] },
  decision: "REQUIRE_APPROVAL",
  approval_route: "senior_oncall",
};

describe("PolicyRuleSchema", () => {
  it("accepts a valid payload matching spec §16's example exactly", () => {
    expect(PolicyRuleSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts an empty `when` (matches everything)", () => {
    expect(PolicyRuleSchema.safeParse({ ...validPayload, when: {} }).success).toBe(true);
  });

  it("defaults immutable to false when omitted", () => {
    const parsed = PolicyRuleSchema.parse(validPayload);
    expect(parsed.immutable).toBe(false);
  });

  it("accepts immutable: true and requires_proposer_approver_separation: true", () => {
    const parsed = PolicyRuleSchema.parse({ ...validPayload, immutable: true, requires_proposer_approver_separation: true });
    expect(parsed.immutable).toBe(true);
    expect(parsed.requires_proposer_approver_separation).toBe(true);
  });

  it("rejects an out-of-enum decision value", () => {
    expect(PolicyRuleSchema.safeParse({ ...validPayload, decision: "MAYBE" }).success).toBe(false);
  });

  it("rejects an out-of-enum risk_class_in entry", () => {
    const broken = { ...validPayload, when: { ...validPayload.when, risk_class_in: ["R2", "R99"] } };
    expect(PolicyRuleSchema.safeParse(broken).success).toBe(false);
  });

  it.each(["rule_id", "when", "decision"])("rejects when required field %s is missing", (field) => {
    const broken = structuredClone(validPayload) as Record<string, unknown>;
    delete broken[field];
    expect(PolicyRuleSchema.safeParse(broken).success).toBe(false);
  });
});
