import { describe, expect, it } from "vitest";
import type { PolicyDecision, ProposedAction } from "@aop/contracts";
import { InMemoryApprovalContextStore } from "./approval-context-store.js";

const proposedAction: ProposedAction = {
  proposal_id: "prop_1",
  request_id: "req_1",
  execution_id: "exec_1",
  tenant_id: "tenant_1",
  action_ref: "restart_service",
  action_version: "1.0.0",
  reason: "x",
  parameters: {},
  expected_outcome: "x",
  risk_assessment: { requested_risk_class: "R1", blast_radius: { scope: "service" }, reversible: true },
  supporting_evidence_ids: [],
  generated_by: { agent: "investigator", model: "sim", prompt_version: "1" },
  accountable_principal_id: "user_1",
  created_at: "2026-08-18T00:00:00.000Z",
};

const policyDecision: PolicyDecision = {
  decision_id: "dec_1",
  proposal_id: "prop_1",
  policy_version: "v1",
  effective_risk_class: "R1",
  outcome: "REQUIRE_APPROVAL",
  reasons: [],
  evidence_summary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 },
  requires_proposer_approver_separation: false,
  created_at: "2026-08-18T00:00:00.000Z",
};

describe("InMemoryApprovalContextStore", () => {
  it("stores and retrieves a context by (tenant_id, approval_id)", async () => {
    const store = new InMemoryApprovalContextStore();
    store.set("tenant_1", "appr_1", { policyDecision, proposedAction });
    expect(await store.get("tenant_1", "appr_1")).toEqual({ policyDecision, proposedAction });
  });

  it("returns undefined for an unknown approval_id", async () => {
    const store = new InMemoryApprovalContextStore();
    expect(await store.get("tenant_1", "never_set")).toBeUndefined();
  });

  it("returns undefined when the approval exists but under a different tenant_id (RULE 4)", async () => {
    const store = new InMemoryApprovalContextStore();
    store.set("tenant_1", "appr_1", { policyDecision, proposedAction });
    expect(await store.get("tenant_2", "appr_1")).toBeUndefined();
  });
});
