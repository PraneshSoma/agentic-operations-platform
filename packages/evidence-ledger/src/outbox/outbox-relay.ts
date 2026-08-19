import type { OutboxEventInput } from "./outbox-event.js";
import { computeRelayLag, type RelayLagReport } from "./relay-lag.js";

/**
 * The separate relay process (ADR-005, story E-02). The outbox pattern's
 * two halves: the producer inserts an `outbox_event` row in the same
 * transaction as its state+evidence write (see PrismaLedgerWriter); this
 * relay, running independently, polls unpublished rows, publishes them,
 * and stamps `published_at`. Publication is at-least-once — a crash
 * between "published to the bus" and "marked published_at" replays the
 * row — so consumers MUST dedupe by the stable `event_id`
 * (see DedupingEventConsumer), never the internal row id.
 */

/** A stored outbox row as the relay sees it — the insert shape plus the relay-managed bookkeeping fields. */
export interface StoredOutboxEvent extends OutboxEventInput {
  published_at: string | undefined;
  delivery_attempts: number;
  last_error: string | undefined;
}

/** Where the relay publishes to (a message bus, a webhook, etc.). Throws on failure; the relay records the failure and retries. */
export interface EventPublisher {
  publish(event: StoredOutboxEvent): Promise<void>;
}

/** The relay's view of the outbox table — abstracted so the relay logic is unit-testable without a database. */
export interface OutboxStore {
  /** Unpublished rows whose available_at <= now, oldest first, up to `limit`. */
  fetchPublishable(now: Date, limit: number): Promise<StoredOutboxEvent[]>;
  markPublished(eventId: string, publishedAt: Date): Promise<void>;
  recordFailure(eventId: string, error: string): Promise<void>;
  /** available_at of the oldest still-unpublished row, or undefined when fully drained. */
  oldestUnpublishedAvailableAt(): Promise<Date | undefined>;
}

export class InMemoryOutboxStore implements OutboxStore {
  private readonly rows = new Map<string, StoredOutboxEvent>();

  /** Test/seed helper — inserts a publishable row. */
  seed(event: OutboxEventInput): void {
    this.rows.set(event.event_id, { ...event, published_at: undefined, delivery_attempts: 0, last_error: undefined });
  }

  async fetchPublishable(now: Date, limit: number): Promise<StoredOutboxEvent[]> {
    return [...this.rows.values()]
      .filter((row) => row.published_at === undefined && new Date(row.available_at).getTime() <= now.getTime())
      .sort((a, b) => new Date(a.available_at).getTime() - new Date(b.available_at).getTime())
      .slice(0, limit);
  }

  async markPublished(eventId: string, publishedAt: Date): Promise<void> {
    const row = this.rows.get(eventId);
    if (row) this.rows.set(eventId, { ...row, published_at: publishedAt.toISOString() });
  }

  async recordFailure(eventId: string, error: string): Promise<void> {
    const row = this.rows.get(eventId);
    if (row) this.rows.set(eventId, { ...row, delivery_attempts: row.delivery_attempts + 1, last_error: error });
  }

  async oldestUnpublishedAvailableAt(): Promise<Date | undefined> {
    const unpublished = [...this.rows.values()]
      .filter((row) => row.published_at === undefined)
      .sort((a, b) => new Date(a.available_at).getTime() - new Date(b.available_at).getTime());
    return unpublished.length > 0 ? new Date(unpublished[0]!.available_at) : undefined;
  }

  /** Test/observability helper. */
  get(eventId: string): StoredOutboxEvent | undefined {
    return this.rows.get(eventId);
  }
}

export interface RunOnceResult {
  published: number;
  failed: number;
}

export class OutboxRelay {
  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: EventPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * One relay pass: publish every currently-publishable row. A publish
   * failure is recorded (delivery_attempts++, last_error) and the row is
   * left unpublished for a later pass — never dropped, never marked
   * published on failure.
   */
  async runOnce(batchSize = 100): Promise<RunOnceResult> {
    const rows = await this.store.fetchPublishable(this.now(), batchSize);
    let published = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.publisher.publish(row);
        await this.store.markPublished(row.event_id, this.now());
        published += 1;
      } catch (error) {
        await this.store.recordFailure(row.event_id, error instanceof Error ? error.message : String(error));
        failed += 1;
      }
    }
    return { published, failed };
  }

  /** Current relay-lag report against the given threshold (see relay-lag.ts). */
  async checkLag(thresholdMs: number): Promise<RelayLagReport> {
    const oldest = await this.store.oldestUnpublishedAvailableAt();
    return computeRelayLag(oldest, this.now(), thresholdMs);
  }
}
