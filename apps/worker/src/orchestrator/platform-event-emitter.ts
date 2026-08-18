import type { PlatformEvent } from "@aop/contracts";

/**
 * PlatformEventEmitter — spec §7 "2. emit an event". Interface +
 * pluggable-implementation pattern, same precedent as
 * ExecutionStateStore. The real implementation writes to the
 * `outbox_event` table (ADR-005, story A-03) inside the same transaction
 * as the state persist — wired up in E-02 (Outbox-pattern event
 * emission), not here.
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
