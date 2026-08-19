import type { PlatformEvent } from "@aop/contracts";

/**
 * Outbox event model (ADR-005, LLD-v1 §2, story E-02). The application-
 * level shape of an `outbox_event` row, kept Prisma-free so the builder
 * and relay logic stay unit-testable without a database.
 *
 * `event_id` (a stable UUID minted once at insert) is what downstream
 * consumers dedupe on — NEVER the internal auto-generated row `id`
 * (LLD-v1 §2). `aggregate_version` lets consumers detect gaps/out-of-order
 * delivery; `event_schema_version` versions the payload shape
 * independently.
 */
export interface OutboxEventInput {
  tenant_id: string;
  event_id: string;
  execution_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  event_schema_version: string;
  payload: Record<string, unknown>;
  available_at: string;
}

export interface BuildOutboxEventOptions {
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  event_schema_version?: string;
  /** When the event becomes eligible for relay pickup — defaults to the event's occurred_at (immediate). */
  available_at?: string;
}

export const DEFAULT_EVENT_SCHEMA_VERSION = "1.0.0";

/**
 * Builds the outbox row that accompanies a PlatformEvent. Pure — the
 * caller (the transactional ledger writer) inserts the returned shape in
 * the SAME transaction as the state + evidence write (ADR-005). The full
 * PlatformEvent is carried as the payload so a relayed consumer gets the
 * complete event, not just a reference.
 */
export function buildOutboxEvent(event: PlatformEvent, options: BuildOutboxEventOptions): OutboxEventInput {
  return {
    tenant_id: event.tenant_id,
    event_id: event.event_id,
    execution_id: event.execution_id,
    event_type: event.event_type,
    aggregate_type: options.aggregate_type,
    aggregate_id: options.aggregate_id,
    aggregate_version: options.aggregate_version,
    event_schema_version: options.event_schema_version ?? DEFAULT_EVENT_SCHEMA_VERSION,
    payload: { ...event },
    available_at: options.available_at ?? event.occurred_at,
  };
}
