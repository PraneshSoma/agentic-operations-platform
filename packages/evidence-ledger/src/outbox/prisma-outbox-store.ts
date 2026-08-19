import type { PrismaClient, OutboxEvent } from "@prisma/client";
import type { OutboxStore, StoredOutboxEvent } from "./outbox-relay.js";

/**
 * Prisma-backed OutboxStore (ADR-005, story E-02) — the relay's real view
 * of the `outbox_event` table. The publishable-rows query is exactly the
 * relay poll ADR-005 anticipates and the schema's partial index
 * (`(tenant_id, available_at) WHERE published_at IS NULL`) serves:
 * unpublished, eligible, oldest first.
 *
 * Integration-tested against a real Postgres, excluded from the default
 * unit-coverage gate like the other Prisma-bound files.
 */
export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly prisma: PrismaClient) {}

  async fetchPublishable(now: Date, limit: number): Promise<StoredOutboxEvent[]> {
    const rows = await this.prisma.outboxEvent.findMany({
      where: { published_at: null, available_at: { lte: now } },
      orderBy: { available_at: "asc" },
      take: limit,
    });
    return rows.map(toStored);
  }

  async markPublished(eventId: string, publishedAt: Date): Promise<void> {
    await this.prisma.outboxEvent.update({ where: { event_id: eventId }, data: { published_at: publishedAt } });
  }

  async recordFailure(eventId: string, error: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { event_id: eventId },
      data: { delivery_attempts: { increment: 1 }, last_error: error },
    });
  }

  async oldestUnpublishedAvailableAt(): Promise<Date | undefined> {
    const oldest = await this.prisma.outboxEvent.findFirst({
      where: { published_at: null },
      orderBy: { available_at: "asc" },
      select: { available_at: true },
    });
    return oldest?.available_at ?? undefined;
  }
}

function toStored(row: OutboxEvent): StoredOutboxEvent {
  return {
    tenant_id: row.tenant_id,
    event_id: row.event_id,
    execution_id: row.execution_id,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    aggregate_version: row.aggregate_version,
    event_schema_version: row.event_schema_version,
    payload: row.payload as Record<string, unknown>,
    available_at: row.available_at.toISOString(),
    published_at: row.published_at?.toISOString(),
    delivery_attempts: row.delivery_attempts,
    last_error: row.last_error ?? undefined,
  };
}
