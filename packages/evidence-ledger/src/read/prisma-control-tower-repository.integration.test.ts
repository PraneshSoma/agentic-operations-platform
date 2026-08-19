import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaControlTowerRepository } from "./prisma-control-tower-repository.js";

/**
 * Real-Postgres integration coverage for the Control Tower read
 * repository (story E-05, F-16, OI-REQ-02). The read-time joins and
 * tenant scoping are DB-level; gated behind VITEST_INTEGRATION, runs
 * against DATABASE_URL.
 */
const NOW = new Date("2026-08-18T12:00:00.000Z");
const TENANT = `tenant_e05_${randomUUID().slice(0, 8)}`;
const EXEC = `exec_${randomUUID().slice(0, 8)}`;
const PROP = `prop_${randomUUID().slice(0, 8)}`;
const RES = `res_${randomUUID().slice(0, 8)}`;

describe("PrismaControlTowerRepository — read-time composite + history (E-05)", () => {
  let prisma: PrismaClient;
  let repo: PrismaControlTowerRepository;

  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new PrismaControlTowerRepository(prisma);
    await prisma.tenant.create({ data: { id: TENANT, name: "E-05 tenant" } });

    await prisma.execution.create({
      data: {
        execution_id: EXEC, tenant_id: TENANT, request_id: "req_1", opc_id: "opc_1", opc_version: "1.0.0",
        state: "VERIFYING", proposal_ids: [PROP], retry_count: 0, budget_consumed: { investigation_tokens: 0, planning_tokens: 0, tool_calls: 0 },
        created_at: NOW, updated_at: NOW,
      },
    });
    // Two evidence rows, deliberately inserted out of chronological order.
    await prisma.evidenceRow.create({
      data: {
        evidence_id: "ev_2", tenant_id: TENANT, request_id: "req_1", execution_id: EXEC, type: "ACTION_RESULT",
        source: { component: "executor" }, content: { summary: "executed" }, relationships: {}, integrity: { created_at: "2026-08-18T12:02:00.000Z", content_hash: "h" },
        retention_class: "operational_state", retention_expires_at: NOW, retention_policy_version: "dev-nonprod-v0", legal_hold: false,
      },
    });
    await prisma.evidenceRow.create({
      data: {
        evidence_id: "ev_1", tenant_id: TENANT, request_id: "req_1", execution_id: EXEC, type: "REQUEST",
        source: { component: "orchestrator.state_machine" }, content: { summary: "received" }, relationships: {}, integrity: { created_at: "2026-08-18T12:00:00.000Z", content_hash: "h" },
        retention_class: "operational_state", retention_expires_at: NOW, retention_policy_version: "dev-nonprod-v0", legal_hold: false,
      },
    });
    await prisma.proposedActionRow.create({
      data: {
        proposal_id: PROP, request_id: "req_1", execution_id: EXEC, tenant_id: TENANT, action_ref: "restart_service", action_version: "1.0.0",
        reason: "recover", parameters: {}, expected_outcome: "healthy",
        risk_assessment: { requested_risk_class: "R2", blast_radius: { scope: "service" }, reversible: true },
        supporting_evidence_ids: [], generated_by: { agent: "planner", model: "sim", prompt_version: "1" }, accountable_principal_id: "user_1", created_at: NOW,
      },
    });
    await prisma.policyDecisionRow.create({
      data: {
        decision_id: "dec_1", tenant_id: TENANT, proposal_id: PROP, policy_version: "v1", effective_risk_class: "R2", outcome: "REQUIRE_APPROVAL",
        reasons: [], evidence_summary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 }, requires_proposer_approver_separation: false, created_at: NOW,
      },
    });
    await prisma.actionExecutionRow.create({
      data: {
        execution_result_id: RES, tenant_id: TENANT, proposal_id: PROP, action_ref: "restart_service", started_at: NOW, completed_at: NOW,
        status: "SUCCESS", output_summary: "ok", side_effects: { systems_touched: [] }, error: {}, rollback_available: false, executor_build_hash: "sha256:x",
      },
    });
    await prisma.verificationRow.create({
      data: { verification_id: "ver_1", tenant_id: TENANT, execution_result_id: RES, checks: [], overall: "VERIFIED", recommended_next_step: "CLOSE" },
    });
    // Version-binding fixtures (E-06): a connector definition, a context
    // package whose provenance names it, and PLAN/APPROVAL evidence
    // carrying the ids that have no dedicated table yet.
    await prisma.connectorDefinition.create({
      data: {
        connector_id: "sim-app", tenant_id: TENANT, type: "api", operations: [], authorization: {}, scopes: {}, staleness: {},
        definition_version: "1.2.0", reliability_level: "MEDIUM",
      },
    });
    await prisma.contextPackageRow.create({
      data: {
        context_package_id: "ctx_1", tenant_id: TENANT, request_id: "req_1", opc_id: "opc_1", assembled_at: NOW,
        application_context: {
          application_id: "checkout", name: "Checkout", owners: [], environments: ["prod"],
          dependencies: { upstream: [], downstream: [] }, apis: [], datastores: [], messaging: [], slo_refs: [], approved_action_refs: [], change_context: {},
        },
        runtime_context: {
          time_window: { from: NOW.toISOString(), to: NOW.toISOString() }, logs: { summaries: [], evidence_refs: [] }, metrics: [], traces: { summaries: [] }, deployment_state: {},
        },
        historical_evidence: { similar_cases: [], aggregate: { precedent_count: 0, verified_success_count: 0, failure_count: 0, rollback_count: 0 } },
        missing_context: [], stale_context: [],
        provenance: [{ connector_ref: "sim-app", query_ref: "q1", retrieved_at: NOW.toISOString() }],
      },
    });
    await prisma.evidenceRow.create({
      data: {
        evidence_id: "ev_plan", tenant_id: TENANT, request_id: "req_1", execution_id: EXEC, type: "PLAN",
        source: { component: "planner" }, content: { summary: "plan frozen", structured_data: { plan_id: "plan_1" } }, relationships: {},
        integrity: { created_at: "2026-08-18T12:01:30.000Z", content_hash: "h" },
        retention_class: "operational_state", retention_expires_at: NOW, retention_policy_version: "dev-nonprod-v0", legal_hold: false,
      },
    });
    await prisma.evidenceRow.create({
      data: {
        evidence_id: "ev_appr", tenant_id: TENANT, request_id: "req_1", execution_id: EXEC, type: "APPROVAL",
        source: { component: "approval-gate" }, content: { summary: "approved", structured_data: { approval_id: "appr_1" } }, relationships: {},
        integrity: { created_at: "2026-08-18T12:01:45.000Z", content_hash: "h" },
        retention_class: "operational_state", retention_expires_at: NOW, retention_policy_version: "dev-nonprod-v0", legal_hold: false,
      },
    });
  });

  afterAll(async () => {
    await prisma.verificationRow.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.actionExecutionRow.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.policyDecisionRow.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.proposedActionRow.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.evidenceRow.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.contextPackageRow.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.connectorDefinition.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.execution.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.tenant.delete({ where: { id: TENANT } });
    await prisma.$disconnect();
  });

  it("CRITICAL (F-16): reconstructs the complete ordered history from Evidence Ledger records alone", async () => {
    const history = await repo.reconstructExecutionHistory(TENANT, EXEC);
    // Chronological by created_at, despite scrambled insertion order:
    // ev_1 (12:00) < ev_plan (12:01:30) < ev_appr (12:01:45) < ev_2 (12:02).
    expect(history?.entries.map((e) => e.evidence_id)).toEqual(["ev_1", "ev_plan", "ev_appr", "ev_2"]);
    expect(history?.entries.map((e) => e.summary)).toEqual(["received", "plan frozen", "approved", "executed"]);
  });

  it("CRITICAL (OI-REQ-02): the composite joins execution + proposals + decisions + verifications + history by execution_id", async () => {
    const view = await repo.getCompositeContextPackage(TENANT, EXEC);
    expect(view).toBeDefined();
    expect(view?.execution.state).toBe("VERIFYING");
    expect(view?.proposed_actions.map((p) => p.proposal_id)).toEqual([PROP]);
    expect(view?.policy_decisions.map((d) => d.outcome)).toEqual(["REQUIRE_APPROVAL"]);
    expect(view?.verifications.map((v) => v.overall)).toEqual(["VERIFIED"]);
    expect(view?.history.entries).toHaveLength(4);
    expect(view?.context_package?.context_package_id).toBe("ctx_1");
  });

  it("CRITICAL (isolation): a wrong-tenant read returns undefined even when the execution id exists", async () => {
    expect(await repo.getCompositeContextPackage("other_tenant", EXEC)).toBeUndefined();
    expect(await repo.reconstructExecutionHistory("other_tenant", EXEC)).toBeUndefined();
  });

  it("returns undefined for an unknown execution id", async () => {
    expect(await repo.getCompositeContextPackage(TENANT, "never")).toBeUndefined();
    expect(await repo.reconstructExecutionHistory(TENANT, "never")).toBeUndefined();
  });

  it("CRITICAL (F-20): getVersionBinding joins every version-binding element for the execution from persisted fields", async () => {
    const binding = await repo.getVersionBinding(TENANT, EXEC);
    expect(binding).toBeDefined();
    expect(binding?.opc_id).toBe("opc_1");
    expect(binding?.opc_version).toBe("1.0.0");
    expect(binding?.action_bindings).toEqual([{ action_ref: "restart_service", action_version: "1.0.0" }]);
    expect(binding?.policy_versions).toEqual(["v1"]);
    expect(binding?.executor_build_hashes).toEqual(["sha256:x"]);
    expect(binding?.model_bindings).toEqual([{ agent: "planner", model: "sim", prompt_version: "1" }]);
    expect(binding?.connector_definition_versions).toEqual([{ connector_id: "sim-app", definition_version: "1.2.0" }]);
    expect(binding?.frozen_plan_ids).toEqual(["plan_1"]); // from PLAN evidence structured_data
    expect(binding?.approval_ids).toEqual(["appr_1"]); // from APPROVAL evidence structured_data
    expect(binding?.evidence_snapshot_reconstructable).toBe(true);
  });

  it("CRITICAL (isolation): getVersionBinding returns undefined for the wrong tenant", async () => {
    expect(await repo.getVersionBinding("other_tenant", EXEC)).toBeUndefined();
  });
});
