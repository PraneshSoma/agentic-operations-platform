import { describe, expect, it } from "vitest";
import type { PolicyDecision, ProposedAction } from "@aop/contracts";
import { LocalDevIdentityResolver } from "@aop/identity";
import { buildApp } from "../app.js";
import { InMemoryApprovalContextStore } from "../approvals/approval-context-store.js";

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
  risk_assessment: { requested_risk_class: "R2", blast_radius: { scope: "service" }, reversible: true },
  supporting_evidence_ids: [],
  generated_by: { agent: "investigator", model: "sim", prompt_version: "1" },
  accountable_principal_id: "user_proposer",
  created_at: "2026-08-18T00:00:00.000Z",
};

function policyDecision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    decision_id: "dec_1",
    proposal_id: "prop_1",
    policy_version: "v1",
    effective_risk_class: "R2",
    outcome: "REQUIRE_APPROVAL",
    reasons: [],
    evidence_summary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 },
    requires_proposer_approver_separation: false,
    created_at: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

function setup(policyDecisionOverrides: Partial<PolicyDecision> = {}) {
  const approvalContextStore = new InMemoryApprovalContextStore();
  approvalContextStore.set("tenant_1", "appr_1", { policyDecision: policyDecision(policyDecisionOverrides), proposedAction });
  const identityResolver = new LocalDevIdentityResolver([
    { id: "user_proposer", tenant_id: "tenant_1", display_name: "Proposer", roles: ["senior_oncall"] },
    { id: "user_approver", tenant_id: "tenant_1", display_name: "Approver", roles: ["senior_oncall"] },
  ]);
  const app = buildApp({ approvalContextStore, identityResolver });
  return { app };
}

describe("POST /tenants/:tenantId/approvals/:approvalId/decision (LLD-v1 §6)", () => {
  it("returns 200 with AUTHORIZED and an authorization_id when every check passes", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/tenants/tenant_1/approvals/appr_1/decision",
      payload: { decision: "APPROVED", actor_ref: "user_approver" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.outcome).toBe("AUTHORIZED");
    expect(typeof body.authorization_id).toBe("string");
  });

  it("returns 403 REJECTED when separation of duties is violated", async () => {
    const { app } = setup({ requires_proposer_approver_separation: true });
    const response = await app.inject({
      method: "POST",
      url: "/tenants/tenant_1/approvals/appr_1/decision",
      payload: { decision: "APPROVED", actor_ref: "user_proposer" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().outcome).toBe("REJECTED");
  });

  it("returns 404 when the approval_id is unknown", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/tenants/tenant_1/approvals/never_created/decision",
      payload: { decision: "APPROVED", actor_ref: "user_approver" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for an invalid decision value", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/tenants/tenant_1/approvals/appr_1/decision",
      payload: { decision: "MAYBE", actor_ref: "user_approver" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when actor_ref is missing", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/tenants/tenant_1/approvals/appr_1/decision",
      payload: { decision: "APPROVED" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("accepts an optional comment without affecting the outcome", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/tenants/tenant_1/approvals/appr_1/decision",
      payload: { decision: "APPROVED", actor_ref: "user_approver", comment: "looks good" },
    });
    expect(response.statusCode).toBe(200);
  });
});
