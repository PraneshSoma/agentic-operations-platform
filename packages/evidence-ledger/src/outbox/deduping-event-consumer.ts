import type { StoredOutboxEvent } from "./outbox-relay.js";

/**
 * A downstream consumer that dedupes by the stable `event_id` (ADR-005,
 * story E-02) — the outbox relay delivers at-least-once, so the same
 * event_id can arrive more than once, and a correct consumer processes it
 * exactly once. It dedupes on `event.event_id`, NEVER on any internal row
 * id (LLD-v1 §2 is explicit that the row id is not what consumers dedupe
 * on) — the relay's StoredOutboxEvent doesn't even carry a row id, by
 * construction.
 */
export class DedupingEventConsumer {
  private readonly seen = new Set<string>();

  constructor(private readonly handler: (event: StoredOutboxEvent) => void | Promise<void>) {}

  /** Delivers an event to the handler exactly once per event_id; a repeat delivery is a no-op. Returns true if the handler ran. */
  async deliver(event: StoredOutboxEvent): Promise<boolean> {
    if (this.seen.has(event.event_id)) {
      return false;
    }
    await this.handler(event);
    this.seen.add(event.event_id);
    return true;
  }

  hasProcessed(eventId: string): boolean {
    return this.seen.has(eventId);
  }
}
