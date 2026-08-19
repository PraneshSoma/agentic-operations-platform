import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Evidence, ExecutionState } from "@aop/contracts";
import { PrismaLedgerWriter, type LedgerTransition } from "./prisma-ledger-writer.js";
import type { OutboxEventInput } from "./outbox-event.js";

/**
 * Real-Postgres integration coverage for the outbox pattern's atomic
 * producer write (story E-02, ADR-005). Proves the state + evidence +
 * outbox_event rows land in ONE transaction — either all three or none —
 * which is a DB-level property no mock can demonstrate. Gated behind
 * VITEST_INTEGRATION; runs against DATABASE_URL.
 */
const NOW = new Date("2026-08-18T12:00:00.000Z");
const TENANT = `tenant_e02w_${randomUUID().slice(0, 8)}`;

function execution(overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    execution_id: `exec_${randomUUID().slice(0, 8)}`,
    tenant_id: TENANT,
    request_id: "req_1",
    opc_id: "opc_1",
    opc_version: "1.0.0",
    state: "EXECUTING",
    proposal_ids: [],
    retry_count: 0,
    budget_consumed: { investigation_tokens: 0, planning_tokens: 0, tool_calls: 0 },
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function evidence(executionId: string, overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidence_id: `ev_${randomUUID().slice(0, 8)}`,
    tenant_id: TENANT,
    request_id: "req_1",
    execution_id: executionId,
    type: "OUTCOME",
    source: { component: "orchestrator.state_machine" },
    content: { summary: "state transition" },
    relationships: {},
    integrity: { created_at: NOW.toISOString(), content_hash: "sha256:x" },
    retention_class: "operational_state",
    retention_expires_at: new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    retention_policy_version: "dev-nonprod-v0",
    legal_hold: false,
    ...overrides,
  };
}

function outboxEvent(executionId: string, overrides: Partial<OutboxEventInput> = {}): OutboxEventInput {
  return {
    tenant_id: TENANT,
    event_id: `evt_${randomUUID().slice(0, 8)}`,
    execution_id: executionId,
    event_type: "execution.started",
    aggregate_type: "execution",
    aggregate_id: executionId,
    aggregate_version: 1,
    event_schema_version: "1.0.0",
    payload: { state: "EXECUTING" },
    available_at: NOW.toISOString(),
    ...overrides,
  };
}

describe("PrismaLedgerWriter — same-transaction state+evidence+outbox write (E-02, ADR-005)", () => {
  let prisma: PrismaClient;
  let writer: PrismaLedgerWriter;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.tenant.create({ data: { id: TENANT, name: "E-02 writer test tenant" } });
    writer = new PrismaLedgerWriter(prisma);
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.evidenceRow.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.execution.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.tenant.delete({ where: { id: TENANT } });
    await prisma.$disconnect();
  });

  it("CRITICAL: persistTransition() lands all three rows (execution, evidence, outbox_event) atomically", async () => {
    const exec = execution();
    const transition: LedgerTransition = {
      execution: exec,
      evidence: evidence(exec.execution_id),
      outboxEvent: outboxEvent(exec.execution_id),
    };
    await writer.persistTransition(transition);

    expect(await prisma.execution.findUnique({ where: { execution_id: exec.execution_id } })).not.toBeNull();
    expect(await prisma.evidenceRow.findUnique({ where: { evidence_id: transition.evidence.evidence_id } })).not.toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { event_id: transition.outboxEvent.event_id } })).not.toBeNull();
  });

  it("CRITICAL: if the outbox insert fails, the state and evidence writes roll back too — never a partial write", async () => {
    // Pre-insert an outbox row so the transition's outbox insert collides
    // on UNIQUE(event_id) and aborts the whole transaction.
    const exec = execution();
    const collidingEventId = `evt_collide_${randomUUID().slice(0, 8)}`;
    await prisma.outboxEvent.create({
      data: {
        tenant_id: TENANT, event_id: collidingEventId, execution_id: "pre_existing", event_type: "x",
        aggregate_type: "execution", aggregate_id: "pre_existing", aggregate_version: 1, event_schema_version: "1.0.0", payload: {},
      },
    });

    const transition: LedgerTransition = {
      execution: exec,
      evidence: evidence(exec.execution_id),
      outboxEvent: outboxEvent(exec.execution_id, { event_id: collidingEventId }),
    };

    await expect(writer.persistTransition(transition)).rejects.toThrow();

    // The whole transaction rolled back: neither the execution nor the
    // evidence row was written, even though their inserts came first.
    expect(await prisma.execution.findUnique({ where: { execution_id: exec.execution_id } })).toBeNull();
    expect(await prisma.evidenceRow.findUnique({ where: { evidence_id: transition.evidence.evidence_id } })).toBeNull();
  });

  it("upserts the execution row on a subsequent transition (state advances, not a duplicate-key error)", async () => {
    const exec = execution({ state: "EXECUTING" });
    await writer.persistTransition({ execution: exec, evidence: evidence(exec.execution_id), outboxEvent: outboxEvent(exec.execution_id) });

    const advanced = { ...exec, state: "VERIFYING" as const, updated_at: new Date(NOW.getTime() + 1000).toISOString() };
    await writer.persistTransition({ execution: advanced, evidence: evidence(exec.execution_id), outboxEvent: outboxEvent(exec.execution_id) });

    const row = await prisma.execution.findUnique({ where: { execution_id: exec.execution_id } });
    expect(row?.state).toBe("VERIFYING");
  });
});
