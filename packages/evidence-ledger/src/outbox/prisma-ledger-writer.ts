import type { Evidence, ExecutionState } from "@aop/contracts";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { OutboxEventInput } from "./outbox-event.js";

/**
 * PrismaLedgerWriter (ADR-005, story E-02) — the outbox pattern's producer
 * half. Writes the ExecutionState transition, its Evidence record, AND the
 * accompanying `outbox_event` row in ONE `prisma.$transaction`, so the
 * event is durably enqueued atomically with the state change it describes:
 * either all three land or none do. This is the concrete realization of
 * ADR-005's core guarantee ("PlatformEvent emission writes to an outbox
 * table in the SAME transaction") — the in-memory PlatformEventEmitter's
 * standalone `emit()` is only the test-double shape; production folds it
 * into this atomic write.
 *
 * Integration-tested against a real Postgres (transaction atomicity is a
 * DB property), so excluded from the default unit-coverage gate like the
 * other Prisma-bound files.
 */
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export interface LedgerTransition {
  execution: ExecutionState;
  evidence: Evidence;
  outboxEvent: OutboxEventInput;
}

export class PrismaLedgerWriter {
  constructor(private readonly prisma: PrismaClient) {}

  async persistTransition(transition: LedgerTransition): Promise<void> {
    const { execution, evidence, outboxEvent } = transition;

    await this.prisma.$transaction([
      this.prisma.execution.upsert({
        where: { execution_id: execution.execution_id },
        create: executionCreate(execution),
        update: { state: execution.state, updated_at: new Date(execution.updated_at), current_proposal_id: execution.current_proposal_id ?? null },
      }),
      this.prisma.evidenceRow.create({ data: evidenceCreate(evidence) }),
      this.prisma.outboxEvent.create({ data: outboxCreate(outboxEvent) }),
    ]);
  }
}

function executionCreate(execution: ExecutionState): Prisma.ExecutionUncheckedCreateInput {
  return {
    execution_id: execution.execution_id,
    tenant_id: execution.tenant_id,
    request_id: execution.request_id,
    opc_id: execution.opc_id,
    opc_version: execution.opc_version,
    state: execution.state,
    context_package_ref: execution.context_package_ref ?? null,
    proposal_ids: execution.proposal_ids,
    current_proposal_id: execution.current_proposal_id ?? null,
    retry_count: execution.retry_count,
    budget_consumed: json(execution.budget_consumed),
    created_at: new Date(execution.created_at),
    updated_at: new Date(execution.updated_at),
  };
}

function evidenceCreate(evidence: Evidence): Prisma.EvidenceRowUncheckedCreateInput {
  return {
    evidence_id: evidence.evidence_id,
    tenant_id: evidence.tenant_id,
    request_id: evidence.request_id,
    execution_id: evidence.execution_id,
    type: evidence.type,
    source: json(evidence.source),
    content: json(evidence.content),
    relationships: json(evidence.relationships),
    integrity: json(evidence.integrity),
    retention_class: evidence.retention_class,
    retention_expires_at: new Date(evidence.retention_expires_at),
    retention_policy_version: evidence.retention_policy_version,
    legal_hold: evidence.legal_hold,
  };
}

function outboxCreate(event: OutboxEventInput): Prisma.OutboxEventUncheckedCreateInput {
  return {
    tenant_id: event.tenant_id,
    event_id: event.event_id,
    execution_id: event.execution_id,
    event_type: event.event_type,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    aggregate_version: event.aggregate_version,
    event_schema_version: event.event_schema_version,
    payload: json(event.payload),
    available_at: new Date(event.available_at),
  };
}
