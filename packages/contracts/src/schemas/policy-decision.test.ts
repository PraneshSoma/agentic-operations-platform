import { describe, expect, it } from "vitest";
import { PolicyDecisionSchema } from "./policy-decision.js";

function omit<T extends object>(obj: T, path: string): T {
  const clone = structuredClone(obj);
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = clone;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]!];
  delete cur[parts[parts.length - 1]!];
  return clone;
}

const validPayload = {
  decision_id: "dec_1",
  proposal_id: "prop_1",
  policy_version: "1.0.0",
  effective_risk_class: "R1",
  outcome: "REQUIRE_APPROVAL",
  approval_route: "senior_oncall",
  reasons: [{ rule_id: "PROD_R1_APPROVAL", explanation: "Production mutation requires approval" }],
  evidence_summary: { precedent_count: 3, verified_success_count: 3, rollback_count: 0, failure_count: 0 },
  requires_proposer_approver_separation: false,
  created_at: "2026-08-17T00:00:00.000Z",
};

describe("PolicyDecisionSchema", () => {
  it("accepts a valid REQUIRE_APPROVAL payload matching spec §4.4's shape", () => {
    expect(PolicyDecisionSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts a hard-deny DENY payload (LLD-v1 §2/§3, ADR-008) with hard_deny_reason_code and hard_deny_detail set", () => {
    const hardDeny = {
      ...omit(validPayload, "approval_route"),
      outcome: "DENY",
      hard_deny_reason_code: "UNREGISTERED_ACTION",
      hard_deny_detail: "action_ref does not match any registered ActionDefinition for this tenant",
      requires_proposer_approver_separation: false,
    };
    expect(PolicyDecisionSchema.safeParse(hardDeny).success).toBe(true);
  });

  it.each([
    "decision_id",
    "proposal_id",
    "policy_version",
    "effective_risk_class",
    "outcome",
    "reasons",
    "evidence_summary.precedent_count",
    "evidence_summary.verified_success_count",
    "evidence_summary.rollback_count",
    "evidence_summary.failure_count",
    "requires_proposer_approver_separation",
    "created_at",
  ])("rejects a payload missing required field %s", (path) => {
    expect(PolicyDecisionSchema.safeParse(omit(validPayload, path)).success).toBe(false);
  });

  it("CRITICAL: accepts DENY as a valid, first-class outcome value — ADR-008's core correction was that DENY must never be silently dropped from the outcome space", () => {
    const denied = { ...validPayload, outcome: "DENY" };
    const parsed = PolicyDecisionSchema.safeParse(denied);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.outcome).toBe("DENY");
  });

  it("CRITICAL: rejects an out-of-enum outcome value — the three-valued ALLOW|REQUIRE_APPROVAL|DENY space (spec §16, ADR-008) must be exhaustive, not extensible by accident", () => {
    const broken = { ...validPayload, outcome: "MAYBE" };
    expect(PolicyDecisionSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum hard_deny_reason_code value — must be one of the 8 fixed HARD_DENY_CHECKS codes, not a free string (LLD-v1 §3)", () => {
    const broken = { ...validPayload, outcome: "DENY", hard_deny_reason_code: "I_JUST_FELT_LIKE_IT" };
    expect(PolicyDecisionSchema.safeParse(broken).success).toBe(false);
  });
});
