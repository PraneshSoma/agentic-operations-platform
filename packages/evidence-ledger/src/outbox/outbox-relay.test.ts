import { describe, expect, it } from "vitest";
import type { OutboxEventInput } from "./outbox-event.js";
import { DEFAULT_RELAY_LAG_THRESHOLD_MS } from "./relay-lag.js";
import { InMemoryOutboxStore, OutboxRelay, type EventPublisher, type StoredOutboxEvent } from "./outbox-relay.js";
import { DedupingEventConsumer } from "./deduping-event-consumer.js";

const NOW = new Date("2026-08-18T12:10:00.000Z");

function outboxEvent(overrides: Partial<OutboxEventInput> = {}): OutboxEventInput {
  return {
    tenant_id: "tenant_1",
    event_id: "evt_1",
    execution_id: "exec_1",
    event_type: "execution.started",
    aggregate_type: "execution",
    aggregate_id: "exec_1",
    aggregate_version: 1,
    event_schema_version: "1.0.0",
    payload: { hello: "world" },
    available_at: "2026-08-18T12:00:00.000Z",
    ...overrides,
  };
}

/** A publisher that records what it published; optionally fails a named event_id N times before succeeding. */
class RecordingPublisher implements EventPublisher {
  readonly published: StoredOutboxEvent[] = [];
  private failuresLeft: Map<string, number>;
  constructor(failFor: Record<string, number> = {}) {
    this.failuresLeft = new Map(Object.entries(failFor));
  }
  async publish(event: StoredOutboxEvent): Promise<void> {
    const remaining = this.failuresLeft.get(event.event_id) ?? 0;
    if (remaining > 0) {
      this.failuresLeft.set(event.event_id, remaining - 1);
      throw new Error(`simulated publish failure for ${event.event_id}`);
    }
    this.published.push(event);
  }
}

describe("OutboxRelay — the separate relay process (E-02, ADR-005)", () => {
  it("publishes an eligible unpublished row and stamps published_at", async () => {
    const store = new InMemoryOutboxStore();
    store.seed(outboxEvent());
    const publisher = new RecordingPublisher();
    const relay = new OutboxRelay(store, publisher, () => NOW);

    const result = await relay.runOnce();
    expect(result).toEqual({ published: 1, failed: 0 });
    expect(publisher.published).toHaveLength(1);
    expect(store.get("evt_1")?.published_at).toBe(NOW.toISOString());
  });

  it("does not pick up a row whose available_at is still in the future", async () => {
    const store = new InMemoryOutboxStore();
    store.seed(outboxEvent({ available_at: "2026-08-18T12:20:00.000Z" })); // 10 min in the future
    const relay = new OutboxRelay(store, new RecordingPublisher(), () => NOW);

    const result = await relay.runOnce();
    expect(result.published).toBe(0);
  });

  it("does not re-publish an already-published row on a second pass", async () => {
    const store = new InMemoryOutboxStore();
    store.seed(outboxEvent());
    const publisher = new RecordingPublisher();
    const relay = new OutboxRelay(store, publisher, () => NOW);

    await relay.runOnce();
    const second = await relay.runOnce();
    expect(second.published).toBe(0);
    expect(publisher.published).toHaveLength(1);
  });

  it("CRITICAL: a publish failure leaves the row unpublished for retry — never marked published, never dropped", async () => {
    const store = new InMemoryOutboxStore();
    store.seed(outboxEvent());
    const publisher = new RecordingPublisher({ evt_1: 1 }); // fail once, then succeed
    const relay = new OutboxRelay(store, publisher, () => NOW);

    const first = await relay.runOnce();
    expect(first).toEqual({ published: 0, failed: 1 });
    expect(store.get("evt_1")?.published_at).toBeUndefined();
    expect(store.get("evt_1")?.delivery_attempts).toBe(1);
    expect(store.get("evt_1")?.last_error).toContain("simulated publish failure");

    const second = await relay.runOnce();
    expect(second).toEqual({ published: 1, failed: 0 });
    expect(store.get("evt_1")?.published_at).toBe(NOW.toISOString());
  });

  it("records a non-Error thrown value via String() coercion, still leaving the row unpublished", async () => {
    const store = new InMemoryOutboxStore();
    store.seed(outboxEvent());
    const publisher: EventPublisher = {
      async publish() {
        throw "plain string failure"; // eslint-disable-line @typescript-eslint/only-throw-error
      },
    };
    const relay = new OutboxRelay(store, publisher, () => NOW);
    const result = await relay.runOnce();
    expect(result).toEqual({ published: 0, failed: 1 });
    expect(store.get("evt_1")?.last_error).toBe("plain string failure");
  });

  it("publishes oldest-available first and respects the batch size", async () => {
    const store = new InMemoryOutboxStore();
    store.seed(outboxEvent({ event_id: "evt_late", available_at: "2026-08-18T12:05:00.000Z" }));
    store.seed(outboxEvent({ event_id: "evt_early", available_at: "2026-08-18T12:00:00.000Z" }));
    const publisher = new RecordingPublisher();
    const relay = new OutboxRelay(store, publisher, () => NOW);

    const result = await relay.runOnce(1); // batch of 1
    expect(result.published).toBe(1);
    expect(publisher.published[0]?.event_id).toBe("evt_early"); // oldest first
  });

  it("checkLag() reports alerting when the oldest unpublished row exceeds the threshold", async () => {
    const store = new InMemoryOutboxStore();
    store.seed(outboxEvent({ available_at: "2026-08-18T12:00:00.000Z" })); // 10 min old at NOW
    const relay = new OutboxRelay(store, new RecordingPublisher(), () => NOW);

    const report = await relay.checkLag(DEFAULT_RELAY_LAG_THRESHOLD_MS);
    expect(report.alerting).toBe(true);
  });

  it("checkLag() reports drained (not alerting) once everything is published", async () => {
    const store = new InMemoryOutboxStore();
    store.seed(outboxEvent({ available_at: "2026-08-18T12:00:00.000Z" }));
    const relay = new OutboxRelay(store, new RecordingPublisher(), () => NOW);
    await relay.runOnce();

    const report = await relay.checkLag(DEFAULT_RELAY_LAG_THRESHOLD_MS);
    expect(report).toEqual({ lag_ms: 0, threshold_ms: DEFAULT_RELAY_LAG_THRESHOLD_MS, alerting: false });
  });

  it("defaults the relay clock to the real wall clock when not injected", async () => {
    const store = new InMemoryOutboxStore();
    store.seed(outboxEvent({ available_at: "2000-01-01T00:00:00.000Z" })); // long past → eligible
    const publisher = new RecordingPublisher();
    const relay = new OutboxRelay(store, publisher);
    const result = await relay.runOnce();
    expect(result.published).toBe(1);
  });
});

describe("DedupingEventConsumer — at-least-once dedup by stable event_id (E-02, ADR-005)", () => {
  function stored(overrides: Partial<StoredOutboxEvent> = {}): StoredOutboxEvent {
    return { ...outboxEvent(), published_at: undefined, delivery_attempts: 0, last_error: undefined, ...overrides };
  }

  it("CRITICAL: processes the same event_id exactly once even when delivered twice (at-least-once)", async () => {
    const handled: string[] = [];
    const consumer = new DedupingEventConsumer((e) => {
      handled.push(e.event_id);
    });

    const ran1 = await consumer.deliver(stored({ event_id: "evt_dup" }));
    const ran2 = await consumer.deliver(stored({ event_id: "evt_dup" })); // redelivery

    expect(ran1).toBe(true);
    expect(ran2).toBe(false);
    expect(handled).toEqual(["evt_dup"]); // handler ran once
    expect(consumer.hasProcessed("evt_dup")).toBe(true);
  });

  it("processes distinct event_ids independently", async () => {
    const handled: string[] = [];
    const consumer = new DedupingEventConsumer((e) => {
      handled.push(e.event_id);
    });
    await consumer.deliver(stored({ event_id: "evt_a" }));
    await consumer.deliver(stored({ event_id: "evt_b" }));
    expect(handled).toEqual(["evt_a", "evt_b"]);
  });

  it("awaits an async handler before marking the event processed", async () => {
    let resolved = false;
    const consumer = new DedupingEventConsumer(async () => {
      await Promise.resolve();
      resolved = true;
    });
    await consumer.deliver(stored({ event_id: "evt_async" }));
    expect(resolved).toBe(true);
  });
});
