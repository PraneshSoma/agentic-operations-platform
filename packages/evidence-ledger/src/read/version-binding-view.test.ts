import { describe, expect, it } from "vitest";
import type { ExecutionResult, ExecutionState, PolicyDecision, ProposedAction } from "@aop/contracts";
import { buildVersionBindingView, type VersionBindingParts } from "./version-binding-view.js";

const NOW = "2026-08-18T12:00:00.000Z";

const execution: ExecutionState = {
  execution_id: "exec_1", tenant_id: "tenant_1", request_id: "req_1", opc_id: "opc_error_spike", opc_version: "2.1.0",
  state: "VERIFYING", proposal_ids: ["prop_1"], retry_count: 0, budget_consumed: { investigation_tokens: 0, planning_tokens: 0, tool_calls: 0 },
  created_at: NOW, updated_at: NOW,
};

const proposedAction: ProposedAction = {
  proposal_id: "prop_1", request_id: "req_1", execution_id: "exec_1", tenant_id: "tenant_1", action_ref: "restart_service", action_version: "3.4.0",
  reason: "recover", parameters: {}, expected_outcome: "healthy",
  risk_assessment: { requested_risk_class: "R2", blast_radius: { scope: "service" }, reversible: true },
  supporting_evidence_ids: [], generated_by: { agent: "planner", model: "sim-llm", prompt_version: "7" }, accountable_principal_id: "user_1", created_at: NOW,
};

const policyDecision: PolicyDecision = {
  decision_id: "dec_1", proposal_id: "prop_1", policy_version: "policy-bundle-9", effective_risk_class: "R2", outcome: "REQUIRE_APPROVAL",
  reasons: [], evidence_summary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 }, requires_proposer_approver_separation: false, created_at: NOW,
};

const executionResult: ExecutionResult = {
  execution_result_id: "res_1", proposal_id: "prop_1", action_ref: "restart_service", started_at: NOW, completed_at: NOW,
  status: "SUCCESS", output_summary: "ok", side_effects: { systems_touched: [] }, error: {}, rollback_available: false, executor_build_hash: "sha256:build-abc",
};

function parts(overrides: Partial<VersionBindingParts> = {}): VersionBindingParts {
  return {
    execution,
    proposedActions: [proposedAction],
    policyDecisions: [policyDecision],
    executionResults: [executionResult],
    connectorDefinitionVersions: [{ connector_id: "sim-app", definition_version: "1.2.0" }],
    frozenPlanIds: ["plan_1"],
    approvalIds: ["appr_1"],
    ...overrides,
  };
}

describe("buildVersionBindingView() — the immutable version binding (E-06, F-20)", () => {
  it("CRITICAL: returns every element in LLD §0's version-binding table for the execution", () => {
    const view = buildVersionBindingView(parts());
    expect(view.opc_id).toBe("opc_error_spike");
    expect(view.opc_version).toBe("2.1.0");
    expect(view.action_bindings).toEqual([{ action_ref: "restart_service", action_version: "3.4.0" }]);
    expect(view.policy_versions).toEqual(["policy-bundle-9"]);
    expect(view.frozen_plan_ids).toEqual(["plan_1"]);
    expect(view.approval_ids).toEqual(["appr_1"]);
    expect(view.model_bindings).toEqual([{ agent: "planner", model: "sim-llm", prompt_version: "7" }]);
    expect(view.connector_definition_versions).toEqual([{ connector_id: "sim-app", definition_version: "1.2.0" }]);
    expect(view.executor_build_hashes).toEqual(["sha256:build-abc"]);
    expect(view.evidence_snapshot_reconstructable).toBe(true);
  });

  it("de-duplicates repeated policy versions, plan ids, approval ids, and build hashes", () => {
    const view = buildVersionBindingView(
      parts({
        policyDecisions: [policyDecision, { ...policyDecision, decision_id: "dec_2", policy_version: "policy-bundle-9" }],
        frozenPlanIds: ["plan_1", "plan_1"],
        approvalIds: ["appr_1", "appr_1"],
        executionResults: [executionResult, { ...executionResult, execution_result_id: "res_2", executor_build_hash: "sha256:build-abc" }],
      }),
    );
    expect(view.policy_versions).toEqual(["policy-bundle-9"]);
    expect(view.frozen_plan_ids).toEqual(["plan_1"]);
    expect(view.approval_ids).toEqual(["appr_1"]);
    expect(view.executor_build_hashes).toEqual(["sha256:build-abc"]);
  });

  it("handles an execution with no proposals/decisions yet — the binding still resolves with the OPC pinned", () => {
    const view = buildVersionBindingView(parts({ proposedActions: [], policyDecisions: [], executionResults: [], frozenPlanIds: [], approvalIds: [], connectorDefinitionVersions: [] }));
    expect(view.opc_id).toBe("opc_error_spike");
    expect(view.action_bindings).toEqual([]);
    expect(view.evidence_snapshot_reconstructable).toBe(true);
  });

  it("carries stable tenant/execution identity", () => {
    const view = buildVersionBindingView(parts());
    expect(view.tenant_id).toBe("tenant_1");
    expect(view.execution_id).toBe("exec_1");
  });
});
