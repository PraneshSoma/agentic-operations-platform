import { describe, expect, it } from "vitest";
import type { Evidence, ExecutionState, ProposedAction } from "@aop/contracts";
import { buildEngineeringContextPackageView, type EngineeringContextPackageParts } from "./engineering-context-package-view.js";

const NOW = "2026-08-18T12:00:00.000Z";

const execution: ExecutionState = {
  execution_id: "exec_1",
  tenant_id: "tenant_1",
  request_id: "req_1",
  opc_id: "opc_1",
  opc_version: "1.0.0",
  state: "VERIFYING",
  proposal_ids: ["prop_1"],
  retry_count: 0,
  budget_consumed: { investigation_tokens: 0, planning_tokens: 0, tool_calls: 0 },
  created_at: NOW,
  updated_at: NOW,
};

const proposedAction: ProposedAction = {
  proposal_id: "prop_1",
  request_id: "req_1",
  execution_id: "exec_1",
  tenant_id: "tenant_1",
  action_ref: "restart_service",
  action_version: "1.0.0",
  reason: "recover",
  parameters: {},
  expected_outcome: "healthy",
  risk_assessment: { requested_risk_class: "R2", blast_radius: { scope: "service" }, reversible: true },
  supporting_evidence_ids: [],
  generated_by: { agent: "planner", model: "sim", prompt_version: "1" },
  accountable_principal_id: "user_1",
  created_at: NOW,
};

function ev(id: string, createdAt: string): Evidence {
  return {
    evidence_id: id, tenant_id: "tenant_1", request_id: "req_1", execution_id: "exec_1", type: "OUTCOME",
    source: { component: "orchestrator.state_machine" }, content: { summary: `event ${id}` }, relationships: {},
    integrity: { created_at: createdAt, content_hash: "sha256:x" },
    retention_class: "operational_state", retention_expires_at: createdAt, retention_policy_version: "dev-nonprod-v0", legal_hold: false,
  };
}

function parts(overrides: Partial<EngineeringContextPackageParts> = {}): EngineeringContextPackageParts {
  return {
    execution,
    contextPackage: null,
    proposedActions: [proposedAction],
    policyDecisions: [],
    verifications: [],
    evidence: [ev("ev_2", "2026-08-18T12:01:00.000Z"), ev("ev_1", "2026-08-18T12:00:00.000Z")],
    ...overrides,
  };
}

describe("buildEngineeringContextPackageView() — read-time composite (E-05, OI-REQ-02)", () => {
  it("joins the parts by execution and carries them through unchanged", () => {
    const view = buildEngineeringContextPackageView(parts());
    expect(view.tenant_id).toBe("tenant_1");
    expect(view.execution_id).toBe("exec_1");
    expect(view.execution).toBe(execution);
    expect(view.proposed_actions).toEqual([proposedAction]);
    expect(view.context_package).toBeNull(); // resolves even when context assembly hadn't run
  });

  it("embeds the reconstructed execution history, ordered from the evidence records", () => {
    const view = buildEngineeringContextPackageView(parts());
    expect(view.history.entries.map((e) => e.evidence_id)).toEqual(["ev_1", "ev_2"]);
  });

  it("resolves with a null context_package without throwing (context assembly optional)", () => {
    expect(() => buildEngineeringContextPackageView(parts({ contextPackage: null }))).not.toThrow();
  });
});
