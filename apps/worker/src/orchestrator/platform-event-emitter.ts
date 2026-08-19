import type { PlatformEvent } from "@aop/contracts";

/**
 * PlatformEventEmitter — spec §7 "2. emit an event". Interface +
 * pluggable-implementation pattern, same precedent as
 * ExecutionStateStore.
 *
 * A standalone `emit()` is the IN-MEMORY test-double shape only. The real
 * outbox pattern (ADR-005) cannot be a separate emit at all: E-02's
 * `PrismaLedgerWriter` (packages/evidence-ledger) folds the outbox_event
 * insert into the SAME `prisma.$transaction` as the state + evidence
 * write, so the event is durably enqueued atomically with the change it
 * describes — never a second, independent write that could succeed or
 * fail on its own. The separate relay (E-02's OutboxRelay) publishes from
 * the outbox asynchronously.
 */
export interface PlatformEventEmitter {
  emit(event: PlatformEvent): Promise<void>;
}

export class InMemoryPlatformEventEmitter implements PlatformEventEmitter {
  private readonly eventsByExecutionId = new Map<string, PlatformEvent[]>();

  async emit(event: PlatformEvent): Promise<void> {
    const events = this.eventsByExecutionId.get(event.execution_id) ?? [];
    events.push(event);
    this.eventsByExecutionId.set(event.execution_id, events);
  }

  /** Test/observability helper. */
  eventsFor(executionId: string): readonly PlatformEvent[] {
    return this.eventsByExecutionId.get(executionId) ?? [];
  }
}
