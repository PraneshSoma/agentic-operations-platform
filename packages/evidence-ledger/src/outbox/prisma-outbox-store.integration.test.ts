import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaOutboxStore } from "./prisma-outbox-store.js";
import { OutboxRelay, type EventPublisher, type StoredOutboxEvent } from "./outbox-relay.js";
import { DEFAULT_RELAY_LAG_THRESHOLD_MS } from "./relay-lag.js";

/**
 * Real-Postgres integration coverage for the relay's DB-backed store
 * (story E-02): the publishable-rows poll (unpublished + eligible +
 * oldest-first, the query the schema's partial index serves), marking
 * published_at, and relay-lag from the oldest unpublished row. Gated
 * behind VITEST_INTEGRATION; runs against DATABASE_URL.
 */
const NOW = new Date("2026-08-18T12:10:00.000Z");
const TENANT = `tenant_e02s_${randomUUID().slice(0, 8)}`;

class RecordingPublisher implements EventPublisher {
  readonly published: StoredOutboxEvent[] = [];
  async publish(event: StoredOutboxEvent): Promise<void> {
    this.published.push(event);
  }
}

async function seedOutbox(prisma: PrismaClient, eventId: string, availableAt: Date): Promise<void> {
  await prisma.outboxEvent.create({
    data: {
      tenant_id: TENANT, event_id: eventId, execution_id: "exec_1", event_type: "execution.started",
      aggregate_type: "execution", aggregate_id: "exec_1", aggregate_version: 1, event_schema_version: "1.0.0",
      payload: { hello: "world" }, available_at: availableAt,
    },
  });
}

describe("PrismaOutboxStore + OutboxRelay — real relay poll/publish (E-02, ADR-005)", () => {
  let prisma: PrismaClient;
  let store: PrismaOutboxStore;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.tenant.create({ data: { id: TENANT, name: "E-02 store test tenant" } });
    store = new PrismaOutboxStore(prisma);
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.tenant.delete({ where: { id: TENANT } });
    await prisma.$disconnect();
  });

  it("CRITICAL: the relay publishes an eligible unpublished row and stamps published_at in the real table", async () => {
    const eventId = `evt_${randomUUID().slice(0, 8)}`;
    await seedOutbox(prisma, eventId, new Date(NOW.getTime() - 60_000));
    const publisher = new RecordingPublisher();
    const relay = new OutboxRelay(store, publisher, () => NOW);

    const result = await relay.runOnce();
    expect(result.published).toBeGreaterThanOrEqual(1);
    expect(publisher.published.some((e) => e.event_id === eventId)).toBe(true);

    const row = await prisma.outboxEvent.findUnique({ where: { event_id: eventId } });
    expect(row?.published_at).not.toBeNull();
  });

  it("does not fetch a row whose available_at is still in the future", async () => {
    const eventId = `evt_future_${randomUUID().slice(0, 8)}`;
    await seedOutbox(prisma, eventId, new Date(NOW.getTime() + 60 * 60_000)); // 1h ahead
    const publishable = await store.fetchPublishable(NOW, 100);
    expect(publishable.some((e) => e.event_id === eventId)).toBe(false);
  });

  it("recordFailure() increments delivery_attempts and stores last_error without marking published", async () => {
    const eventId = `evt_fail_${randomUUID().slice(0, 8)}`;
    await seedOutbox(prisma, eventId, new Date(NOW.getTime() - 60_000));
    await store.recordFailure(eventId, "boom");
    const row = await prisma.outboxEvent.findUnique({ where: { event_id: eventId } });
    expect(row?.delivery_attempts).toBe(1);
    expect(row?.last_error).toBe("boom");
    expect(row?.published_at).toBeNull();
  });

  it("oldestUnpublishedAvailableAt() drives relay-lag against the real table", async () => {
    // A very old unpublished row makes checkLag alert.
    await seedOutbox(prisma, `evt_old_${randomUUID().slice(0, 8)}`, new Date(NOW.getTime() - 60 * 60_000));
    const relay = new OutboxRelay(store, new RecordingPublisher(), () => NOW);
    const report = await relay.checkLag(DEFAULT_RELAY_LAG_THRESHOLD_MS);
    expect(report.alerting).toBe(true);
  });
});
