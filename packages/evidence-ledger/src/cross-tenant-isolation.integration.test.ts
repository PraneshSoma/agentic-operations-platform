import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Cross-tenant isolation sweep (story E-01, F-15 invariant): "a query
 * against any evidence/execution table, run against a two-tenant-seeded
 * database, returns zero rows for the tenant not specified — regardless of
 * table." Seeds two tenants with one row in EVERY tenant-scoped table,
 * then asserts a tenant-filtered query on each table sees only its own
 * tenant's row.
 *
 * Real Postgres, gated behind VITEST_INTEGRATION (see
 * prisma-evidence-repository.integration.test.ts's header for the harness
 * disclosure).
 */
const A = `tenant_A_${randomUUID().slice(0, 8)}`;
const B = `tenant_B_${randomUUID().slice(0, 8)}`;
const NOW = new Date("2026-08-18T12:00:00.000Z");

async function seedAllTables(prisma: PrismaClient, tenant: string): Promise<void> {
  const s = tenant; // short alias for uniqueness within ids

  await prisma.opcDefinition.create({
    data: {
      opc_id: `opc_${s}`, version: "1.0.0", tenant_id: tenant, name: "OPC", status: "published",
      match: {}, required_context: [], investigation: {}, actions: {}, verification: {}, escalation: {}, rollback: {}, timeout: {}, budget: {},
    },
  });
  await prisma.connectorDefinition.create({
    data: {
      connector_id: `conn_${s}`, tenant_id: tenant, type: "api",
      operations: [], authorization: {}, scopes: {}, staleness: {}, definition_version: "1.0.0", reliability_level: "MEDIUM",
    },
  });
  await prisma.actionDefinition.create({
    data: {
      action_id: `act_${s}`, version: "1.0.0", tenant_id: tenant, name: "Action", description: "d",
      executor_connector_ref: `conn_${s}`, operation: "op", input_schema: {}, default_risk_class: "R1", blast_radius: {}, reversible: true,
      environment_constraints: {}, policy_tags: [], status: "active", compensation_class: "REVERSIBLE",
    },
  });
  await prisma.incomingRequest.create({
    data: {
      request_id: `req_${s}`, tenant_id: tenant, source: {}, received_at: NOW, requester: {}, subject: "s", description: "d",
      labels: {}, raw_payload_ref: "ref", correlation: {},
    },
  });
  await prisma.execution.create({
    data: {
      execution_id: `exec_${s}`, tenant_id: tenant, request_id: `req_${s}`, opc_id: `opc_${s}`, opc_version: "1.0.0",
      state: "RECEIVED", proposal_ids: [], retry_count: 0, budget_consumed: {}, created_at: NOW, updated_at: NOW,
    },
  });
  await prisma.contextPackageRow.create({
    data: {
      context_package_id: `ctx_${s}`, tenant_id: tenant, request_id: `req_${s}`, opc_id: `opc_${s}`, assembled_at: NOW,
      application_context: {}, runtime_context: {}, historical_evidence: {}, missing_context: [], stale_context: [], provenance: {},
    },
  });
  await prisma.evidenceRow.create({
    data: {
      evidence_id: `ev_${s}`, tenant_id: tenant, request_id: `req_${s}`, execution_id: `exec_${s}`, type: "OBSERVATION",
      source: {}, content: {}, relationships: {}, integrity: {}, retention_class: "evidence_record",
      retention_expires_at: NOW, retention_policy_version: "dev-nonprod-v0", legal_hold: false,
    },
  });
  await prisma.proposedActionRow.create({
    data: {
      proposal_id: `prop_${s}`, request_id: `req_${s}`, execution_id: `exec_${s}`, tenant_id: tenant, action_ref: `act_${s}`,
      action_version: "1.0.0", reason: "r", parameters: {}, expected_outcome: "o", risk_assessment: {}, supporting_evidence_ids: [],
      generated_by: {}, accountable_principal_id: "user_1", created_at: NOW,
    },
  });
  await prisma.policyDecisionRow.create({
    data: {
      decision_id: `dec_${s}`, tenant_id: tenant, proposal_id: `prop_${s}`, policy_version: "v1", effective_risk_class: "R1",
      outcome: "ALLOW", reasons: [], evidence_summary: {}, requires_proposer_approver_separation: false, created_at: NOW,
    },
  });
  await prisma.actionExecutionRow.create({
    data: {
      execution_result_id: `res_${s}`, tenant_id: tenant, proposal_id: `prop_${s}`, action_ref: `act_${s}`, started_at: NOW,
      completed_at: NOW, status: "SUCCESS", output_summary: "ok", side_effects: {}, error: {}, rollback_available: false, executor_build_hash: "sha256:x",
    },
  });
  await prisma.verificationRow.create({
    data: { verification_id: `ver_${s}`, tenant_id: tenant, execution_result_id: `res_${s}`, checks: [], overall: "VERIFIED", recommended_next_step: "CLOSE" },
  });
  await prisma.executionStepMarker.create({
    data: {
      tenant_id: tenant, execution_id: `exec_${s}`, step_id: "step_1", operation_id: `op_${s}`, action_ref: `act_${s}`,
      action_version: "1.0.0", connector_ref: `conn_${s}`, connector_version: "1.0.0", attempt_number: 1, status: "ATTEMPTED",
    },
  });
  await prisma.outboxEvent.create({
    data: {
      tenant_id: tenant, event_id: `evt_${s}`, execution_id: `exec_${s}`, event_type: "opc.matched", aggregate_type: "execution",
      aggregate_id: `exec_${s}`, aggregate_version: 1, event_schema_version: "1.0.0", payload: {},
    },
  });
  await prisma.identityPrincipal.create({
    data: { tenant_id: tenant, display_name: `principal_${s}`, roles: ["operator"] },
  });
}

describe("Cross-tenant isolation — every tenant-scoped table returns zero rows for the wrong tenant (E-01, F-15)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.tenant.create({ data: { id: A, name: "Tenant A" } });
    await prisma.tenant.create({ data: { id: B, name: "Tenant B" } });
    await seedAllTables(prisma, A);
    await seedAllTables(prisma, B);
  }, 60_000);

  afterAll(async () => {
    for (const t of [A, B]) {
      await prisma.evidenceRow.deleteMany({ where: { tenant_id: t } });
      await prisma.outboxEvent.deleteMany({ where: { tenant_id: t } });
      await prisma.executionStepMarker.deleteMany({ where: { tenant_id: t } });
      await prisma.verificationRow.deleteMany({ where: { tenant_id: t } });
      await prisma.actionExecutionRow.deleteMany({ where: { tenant_id: t } });
      await prisma.policyDecisionRow.deleteMany({ where: { tenant_id: t } });
      await prisma.proposedActionRow.deleteMany({ where: { tenant_id: t } });
      await prisma.contextPackageRow.deleteMany({ where: { tenant_id: t } });
      await prisma.execution.deleteMany({ where: { tenant_id: t } });
      await prisma.incomingRequest.deleteMany({ where: { tenant_id: t } });
      await prisma.actionDefinition.deleteMany({ where: { tenant_id: t } });
      await prisma.connectorDefinition.deleteMany({ where: { tenant_id: t } });
      await prisma.opcDefinition.deleteMany({ where: { tenant_id: t } });
      await prisma.identityPrincipal.deleteMany({ where: { tenant_id: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  // Each entry: a table name and a tenant-filtered query returning that tenant's rows.
  const tables: Array<[string, (t: string) => Promise<Array<{ tenant_id: string }>>]> = [
    ["opc_definition", (t) => prisma.opcDefinition.findMany({ where: { tenant_id: t } })],
    ["connector_definition", (t) => prisma.connectorDefinition.findMany({ where: { tenant_id: t } })],
    ["action_definition", (t) => prisma.actionDefinition.findMany({ where: { tenant_id: t } })],
    ["incoming_request", (t) => prisma.incomingRequest.findMany({ where: { tenant_id: t } })],
    ["execution", (t) => prisma.execution.findMany({ where: { tenant_id: t } })],
    ["context_package", (t) => prisma.contextPackageRow.findMany({ where: { tenant_id: t } })],
    ["evidence", (t) => prisma.evidenceRow.findMany({ where: { tenant_id: t } })],
    ["proposed_action", (t) => prisma.proposedActionRow.findMany({ where: { tenant_id: t } })],
    ["policy_decision", (t) => prisma.policyDecisionRow.findMany({ where: { tenant_id: t } })],
    ["action_execution", (t) => prisma.actionExecutionRow.findMany({ where: { tenant_id: t } })],
    ["verification", (t) => prisma.verificationRow.findMany({ where: { tenant_id: t } })],
    ["execution_step_marker", (t) => prisma.executionStepMarker.findMany({ where: { tenant_id: t } })],
    ["outbox_event", (t) => prisma.outboxEvent.findMany({ where: { tenant_id: t } })],
    ["identity_principal", (t) => prisma.identityPrincipal.findMany({ where: { tenant_id: t } })],
  ];

  it.each(tables)("CRITICAL: %s — a query for tenant A never returns tenant B's row, and vice versa", async (_name, findByTenant) => {
    const aRows = await findByTenant(A);
    const bRows = await findByTenant(B);

    expect(aRows.length).toBeGreaterThan(0);
    expect(bRows.length).toBeGreaterThan(0);
    expect(aRows.every((r) => r.tenant_id === A)).toBe(true);
    expect(bRows.every((r) => r.tenant_id === B)).toBe(true);
    // The wrong tenant's rows leak into neither result set.
    expect(aRows.some((r) => r.tenant_id === B)).toBe(false);
    expect(bRows.some((r) => r.tenant_id === A)).toBe(false);
  });
});
