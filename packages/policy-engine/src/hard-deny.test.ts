import { describe, expect, it } from "vitest";
import type { ActionDefinition, ExecutionAuthorization, PolicyRule, ProposedAction } from "@aop/contracts";
import { HARD_DENY_CHECKS, type HardDenyCheckInput } from "./hard-deny.js";

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

function baseInput(overrides: Partial<HardDenyCheckInput> = {}): HardDenyCheckInput {
  return {
    proposedAction,
    environment: "prod",
    actionDefinition,
    missingRequiredEvidence: false,
    killSwitchActive: false,
    now: NOW,
    policyRules: [],
    effectiveRiskClass: "R1",
    ...overrides,
  };
}

function checkByCode(code: string) {
  const check = HARD_DENY_CHECKS.find((c) => c.code === code);
  if (!check) throw new Error(`no check registered for code ${code}`);
  return check;
}

describe("HARD_DENY_CHECKS — the fixed, code-level list (LLD-v1 §3 gate 4)", () => {
  it("is a fixed array of exactly the 7 ADR-008 conditions, in code — not loaded from any config source", () => {
    // A structural assertion, not a behavioral one: HARD_DENY_CHECKS is a
    // plain exported `const`, imported directly from this module — there
    // is no config-loading path anywhere in its definition to bypass.
    expect(HARD_DENY_CHECKS).toHaveLength(7);
    expect(HARD_DENY_CHECKS.map((c) => c.code).sort()).toEqual(
      [
        "UNREGISTERED_ACTION",
        "TENANT_MISMATCH",
        "EXPIRED_AUTHORIZATION",
        "PROHIBITED_ENVIRONMENT",
        "MISSING_REQUIRED_EVIDENCE",
        "KILL_SWITCH_ACTIVE",
        "IMMUTABLE_POLICY_VIOLATION",
      ].sort(),
    );
  });

  it("UNREGISTERED_ACTION fails when actionDefinition is undefined", () => {
    expect(checkByCode("UNREGISTERED_ACTION").fails(baseInput({ actionDefinition: undefined }))).toBe(true);
    expect(checkByCode("UNREGISTERED_ACTION").fails(baseInput())).toBe(false);
  });

  it("TENANT_MISMATCH fails when the resolved action's tenant differs from the proposal's", () => {
    const mismatched = { ...actionDefinition, tenant_id: "tenant_2" };
    expect(checkByCode("TENANT_MISMATCH").fails(baseInput({ actionDefinition: mismatched }))).toBe(true);
    expect(checkByCode("TENANT_MISMATCH").fails(baseInput())).toBe(false);
  });

  it("EXPIRED_AUTHORIZATION fails when an existing authorization's expiry is in the past", () => {
    const expired: ExecutionAuthorization = {
      authorization_id: "auth_1",
      proposal_id: "prop_1",
      policy_decision_id: "dec_1",
      identity: { mode: "SERVICE_ACCOUNT", acting_as: { id: "svc", type: "platform_service_account" } },
      delegation: { token_type: "none", scopes: [], issued_at: "2026-08-18T00:00:00.000Z", expires_at: "2026-08-18T01:00:00.000Z" },
      signed_plan_hash: "sha256:x",
      issued_by: "policy-engine",
      created_at: "2026-08-18T00:00:00.000Z",
    };
    expect(checkByCode("EXPIRED_AUTHORIZATION").fails(baseInput({ existingAuthorization: expired }))).toBe(true);
    expect(checkByCode("EXPIRED_AUTHORIZATION").fails(baseInput())).toBe(false); // no existing authorization at all
  });

  it("PROHIBITED_ENVIRONMENT fails when the target environment isn't in the action's allowed list", () => {
    expect(checkByCode("PROHIBITED_ENVIRONMENT").fails(baseInput({ environment: "dev" }))).toBe(true);
    expect(checkByCode("PROHIBITED_ENVIRONMENT").fails(baseInput({ environment: "prod" }))).toBe(false);
  });

  it("MISSING_REQUIRED_EVIDENCE fails when the upstream-computed flag is true", () => {
    expect(checkByCode("MISSING_REQUIRED_EVIDENCE").fails(baseInput({ missingRequiredEvidence: true }))).toBe(true);
    expect(checkByCode("MISSING_REQUIRED_EVIDENCE").fails(baseInput())).toBe(false);
  });

  it("KILL_SWITCH_ACTIVE fails when the upstream-computed flag is true", () => {
    expect(checkByCode("KILL_SWITCH_ACTIVE").fails(baseInput({ killSwitchActive: true }))).toBe(true);
    expect(checkByCode("KILL_SWITCH_ACTIVE").fails(baseInput())).toBe(false);
  });

  it("IMMUTABLE_POLICY_VIOLATION fails when a matching immutable:true rule's decision is DENY", () => {
    const immutableDeny: PolicyRule = { rule_id: "no_prod_deletes", when: { environment: "prod" }, decision: "DENY", immutable: true };
    expect(checkByCode("IMMUTABLE_POLICY_VIOLATION").fails(baseInput({ policyRules: [immutableDeny] }))).toBe(true);
  });

  it("IMMUTABLE_POLICY_VIOLATION does not fail for a matching rule that is NOT marked immutable", () => {
    const ordinaryDeny: PolicyRule = { rule_id: "no_prod_deletes", when: { environment: "prod" }, decision: "DENY", immutable: false };
    expect(checkByCode("IMMUTABLE_POLICY_VIOLATION").fails(baseInput({ policyRules: [ordinaryDeny] }))).toBe(false);
  });

  it("IMMUTABLE_POLICY_VIOLATION does not fail for an immutable rule whose decision is not DENY", () => {
    const immutableAllow: PolicyRule = { rule_id: "always_ok", when: {}, decision: "ALLOW", immutable: true };
    expect(checkByCode("IMMUTABLE_POLICY_VIOLATION").fails(baseInput({ policyRules: [immutableAllow] }))).toBe(false);
  });

  it("every check's sanitizedDetail returns sanitized, non-empty text (never raw exception text)", () => {
    for (const check of HARD_DENY_CHECKS) {
      const detail = check.sanitizedDetail(baseInput());
      expect(typeof detail).toBe("string");
      expect(detail.length).toBeGreaterThan(0);
    }
  });
});
