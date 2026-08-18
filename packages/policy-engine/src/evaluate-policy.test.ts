import { describe, expect, it } from "vitest";
import type { ActionDefinition, PolicyRule, ProposedAction } from "@aop/contracts";
import { evaluatePolicy, type PolicyEvaluationInput } from "./evaluate-policy.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");

const proposedAction: ProposedAction = {
  proposal_id: "prop_1",
  request_id: "req_1",
  execution_id: "exec_1",
  tenant_id: "tenant_1",
  action_ref: "restart_service",
  action_version: "1.0.0",
  reason: "recover from error spike",
  parameters: {},
  expected_outcome: "service healthy",
  risk_assessment: { requested_risk_class: "R1", blast_radius: { scope: "service" }, reversible: true },
  supporting_evidence_ids: [],
  generated_by: { agent: "investigator", model: "sim", prompt_version: "1" },
  accountable_principal_id: "user_1",
  created_at: NOW.toISOString(),
};

const actionDefinition: ActionDefinition = {
  action_id: "restart_service",
  version: "1.0.0",
  tenant_id: "tenant_1",
  name: "Restart Service",
  description: "x",
  executor_connector_ref: "k8s-connector",
  operation: "restart",
  input_schema: {},
  default_risk_class: "R1",
  blast_radius: { scope: "service" },
  reversible: true,
  environment_constraints: { allowed: ["prod"] },
  policy_tags: [],
  status: "active",
  compensation_class: "REVERSIBLE",
};

const evidenceSummary = { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 };

function baseInput(overrides: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return {
    decisionId: "dec_1",
    createdAt: NOW.toISOString(),
    proposedAction,
    environment: "prod",
    actionDefinition,
    missingRequiredEvidence: false,
    killSwitchActive: false,
    policyRules: [],
    policyVersion: "v1",
    evidenceSummary,
    now: NOW,
    ...overrides,
  };
}

describe("evaluatePolicy — Phase 1 (hard-deny) beats Phase 2 unconditionally", () => {
  /**
   * Required test per story C-03's acceptance criteria, kept as its own
   * named function so its existence and pass/fail state are both
   * explicit: a tenant policy trying to ALLOW an unregistered action
   * still returns DENY.
   */
  function test_hardDeny_cannotBeOverriddenByAnyPolicyRule(): void {
    const allowEverything: PolicyRule = { rule_id: "allow_everything", when: {}, decision: "ALLOW", immutable: false };
    const decision = evaluatePolicy(
      baseInput({
        actionDefinition: undefined, // unregistered — UNREGISTERED_ACTION hard-deny
        policyRules: [allowEverything],
      }),
    );
    expect(decision.outcome).toBe("DENY");
    expect(decision.hard_deny_reason_code).toBe("UNREGISTERED_ACTION");
  }

  it("test_hardDeny_cannotBeOverriddenByAnyPolicyRule", () => {
    test_hardDeny_cannotBeOverriddenByAnyPolicyRule();
  });

  it("CRITICAL: an immutable DENY rule cannot be overridden by another, later-listed ALLOW rule", () => {
    const immutableDeny: PolicyRule = { rule_id: "no_prod_restarts", when: { environment: "prod" }, decision: "DENY", immutable: true };
    const allowAnyway: PolicyRule = { rule_id: "allow_anyway", when: {}, decision: "ALLOW", immutable: false };
    const decision = evaluatePolicy(baseInput({ policyRules: [allowAnyway, immutableDeny] }));
    expect(decision.outcome).toBe("DENY");
    expect(decision.hard_deny_reason_code).toBe("IMMUTABLE_POLICY_VIOLATION");
  });
});

describe("evaluatePolicy — Phase 2 (tenant rules)", () => {
  it("ALLOWs when the first matching rule's decision is ALLOW", () => {
    const rule: PolicyRule = { rule_id: "allow_r1", when: { risk_class_in: ["R1"] }, decision: "ALLOW", immutable: false };
    const decision = evaluatePolicy(baseInput({ policyRules: [rule] }));
    expect(decision.outcome).toBe("ALLOW");
  });

  it("uses the FIRST matching rule when multiple rules match", () => {
    const first: PolicyRule = {
      rule_id: "first",
      when: { environment: "prod" },
      decision: "REQUIRE_APPROVAL",
      approval_route: "approver_a",
      immutable: false,
    };
    const second: PolicyRule = { rule_id: "second", when: { environment: "prod" }, decision: "ALLOW", immutable: false };
    const decision = evaluatePolicy(baseInput({ policyRules: [first, second] }));
    expect(decision.outcome).toBe("REQUIRE_APPROVAL");
    expect(decision.approval_route).toBe("approver_a");
  });

  it("defaults to REQUIRE_APPROVAL when no tenant rule matches — never a silent ALLOW, never a DENY reserved for Phase 1", () => {
    const decision = evaluatePolicy(baseInput({ policyRules: [] }));
    expect(decision.outcome).toBe("REQUIRE_APPROVAL");
    expect(decision.hard_deny_reason_code).toBeUndefined();
  });

  it("sets requires_proposer_approver_separation from the matched rule (consumed later by C-04, not enforced here)", () => {
    const rule: PolicyRule = {
      rule_id: "separation_required",
      when: {},
      decision: "REQUIRE_APPROVAL",
      requires_proposer_approver_separation: true,
      immutable: false,
    };
    const decision = evaluatePolicy(baseInput({ policyRules: [rule] }));
    expect(decision.requires_proposer_approver_separation).toBe(true);
    // This story's own scope: the flag is set, not enforced. No approval
    // logic runs here — evaluatePolicy has no notion of "who approved."
  });

  it("requires_proposer_approver_separation defaults to false when the matched rule doesn't set it", () => {
    const rule: PolicyRule = { rule_id: "no_separation", when: {}, decision: "ALLOW", immutable: false };
    const decision = evaluatePolicy(baseInput({ policyRules: [rule] }));
    expect(decision.requires_proposer_approver_separation).toBe(false);
  });

  it("requires_proposer_approver_separation defaults to false on the no-match default path too", () => {
    const decision = evaluatePolicy(baseInput({ policyRules: [] }));
    expect(decision.requires_proposer_approver_separation).toBe(false);
  });
});

describe("evaluatePolicy — fail-closed on any evaluation failure (ADR-008)", () => {
  it("CRITICAL: a malformed policy rule resolves to DENY(POLICY_EVALUATION_FAILED), never REQUIRE_APPROVAL", () => {
    const malformedRules = [{ rule_id: "broken", when: {}, decision: "NOT_A_REAL_DECISION" }]; // fails PolicyRuleSchema
    const decision = evaluatePolicy(baseInput({ policyRules: malformedRules }));
    expect(decision.outcome).toBe("DENY");
    expect(decision.hard_deny_reason_code).toBe("POLICY_EVALUATION_FAILED");
  });

  it("CRITICAL: missing/invalid required input resolves to DENY(POLICY_EVALUATION_FAILED)", () => {
    // Simulates a call site that didn't validate its own input before
    // calling evaluatePolicy — an existingAuthorization with no
    // `delegation` object at all (a genuinely malformed shape, not just
    // an early date) throws a TypeError inside the EXPIRED_AUTHORIZATION
    // check's property access, not before it.
    const brokenAuth = {
      authorization_id: "auth_1",
      proposal_id: "prop_1",
      policy_decision_id: "dec_1",
      identity: { mode: "SERVICE_ACCOUNT", acting_as: { id: "svc", type: "platform_service_account" } },
      // delegation is missing entirely — malformed input, not a valid shape with an early date.
      signed_plan_hash: "sha256:x",
      issued_by: "policy-engine",
      created_at: "2026-08-18T00:00:00.000Z",
    };
    const decision = evaluatePolicy(
      baseInput({ existingAuthorization: brokenAuth as unknown as PolicyEvaluationInput["existingAuthorization"] }),
    );
    expect(decision.outcome).toBe("DENY");
    expect(decision.hard_deny_reason_code).toBe("POLICY_EVALUATION_FAILED");
  });

  it("never returns REQUIRE_APPROVAL on any failure path — outcome is always DENY when hard_deny_reason_code is POLICY_EVALUATION_FAILED", () => {
    const decision = evaluatePolicy(baseInput({ policyRules: "not even an array" }));
    expect(decision.outcome).toBe("DENY");
    expect(decision.hard_deny_reason_code).toBe("POLICY_EVALUATION_FAILED");
  });
});

describe("evaluatePolicy — determinism (NFR-05)", () => {
  it("CRITICAL: the same ProposedAction + policy version evaluated twice produces a byte-identical PolicyDecision", () => {
    const input = baseInput({ policyRules: [{ rule_id: "allow_r1", when: { risk_class_in: ["R1"] }, decision: "ALLOW" }] });
    const first = evaluatePolicy(input);
    const second = evaluatePolicy(input);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("determinism holds on the hard-deny path too", () => {
    const input = baseInput({ actionDefinition: undefined });
    expect(JSON.stringify(evaluatePolicy(input))).toBe(JSON.stringify(evaluatePolicy(input)));
  });

  it("determinism holds on the fail-closed path too", () => {
    const input = baseInput({ policyRules: "garbage" });
    expect(JSON.stringify(evaluatePolicy(input))).toBe(JSON.stringify(evaluatePolicy(input)));
  });
});

describe("evaluatePolicy — effective_risk_class", () => {
  it("uses the registered ActionDefinition's default_risk_class when the action is registered", () => {
    const decision = evaluatePolicy(baseInput({ actionDefinition: { ...actionDefinition, default_risk_class: "R2" } }));
    expect(decision.effective_risk_class).toBe("R2");
  });

  it("falls back to the proposal's requested_risk_class when the action is unregistered (hard-deny path)", () => {
    const decision = evaluatePolicy(baseInput({ actionDefinition: undefined }));
    expect(decision.effective_risk_class).toBe("R1"); // proposedAction.risk_assessment.requested_risk_class
  });
});
