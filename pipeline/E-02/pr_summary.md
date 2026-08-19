# E-02: Event model + outbox-pattern PlatformEvent emission

**Phase:** E — Evidence, confidence, dashboard
**Depends on:** B-03
**Status:** DONE

## Summary

The full outbox pattern (ADR-005): a transactional producer that writes
the `outbox_event` row atomically with the state+evidence write, a
separate relay that publishes and stamps `published_at`, a deduping
consumer keyed on the stable `event_id`, and relay-lag alerting with a
configurable 5-minute default (OI-LLD-02, folded in per LLD-v1 §8). Pure
logic is unit-tested at 100% in the default gate; the Prisma-bound
transactional writer and relay store are integration-tested against a
real Postgres.

## Design decisions

- **The producer half is a combined transactional writer, not a
  standalone emitter — because ADR-005 forbids a separate emit.**
  `PrismaLedgerWriter.persistTransition()` writes the execution state
  row, its evidence row, AND the `outbox_event` row in one
  `prisma.$transaction`: all three land or none do. This is the whole
  point of the outbox pattern (the event can't be lost after the state
  changed, nor emitted for a state change that rolled back). B-03's
  `PlatformEventEmitter.emit()` interface is therefore explicitly only
  the in-memory test-double shape — its comment is updated to say so and
  point at this writer as the real mechanism.
- **The relay is genuinely separate and genuinely retries.**
  `OutboxRelay.runOnce()` polls publishable rows (unpublished + eligible
  + oldest-first), publishes each via a pluggable `EventPublisher`, and
  marks `published_at` only on success. A publish failure records
  `delivery_attempts++` / `last_error` and leaves the row unpublished for
  a later pass — a `CRITICAL` unit test proves a failed publish is never
  marked published and never dropped, then succeeds on retry.
- **Consumers dedupe on `event_id`, never the row id — proven, not just
  asserted.** `DedupingEventConsumer` tracks seen `event_id`s; a
  `CRITICAL` test delivers the same event twice (simulating at-least-once
  delivery) and shows the handler runs exactly once. By construction the
  relay's `StoredOutboxEvent` doesn't even carry an internal row id, so
  deduping on the wrong field isn't possible.
- **Relay-lag alerting ships with the number filled in (OI-LLD-02).**
  `DEFAULT_RELAY_LAG_THRESHOLD_MS = 5 min`, tenant-overridable via
  `resolveRelayLagThresholdMs()`. "Lag" is how long the oldest
  still-unpublished row has been eligible without publishing;
  `computeRelayLag()` alerts when that exceeds the threshold. A
  non-positive tenant override falls back to the default rather than
  silently disabling the alarm.
- **Same pure/Prisma coverage split as E-01.** `buildOutboxEvent`,
  `relay-lag`, `OutboxRelay` (against an in-memory store), and
  `DedupingEventConsumer` are pure/dependency-free and unit-tested at
  100% in the default gate. `PrismaLedgerWriter` and `PrismaOutboxStore`
  are DB-bound (transaction atomicity, the partial-index poll query) and
  excluded from the default coverage gate, verified instead by
  `.integration.test.ts` suites — which, like E-01's, connect to
  `DATABASE_URL` directly so they actually run in this environment
  (Testcontainers is proxy-blocked). **7 integration tests executed and
  passing against live PostgreSQL 16**, including the atomic-rollback
  test (a colliding `event_id` aborts the whole transaction; neither the
  execution nor the evidence row persists).

## Files

- `packages/evidence-ledger/src/outbox/outbox-event.ts` (+ test) — `buildOutboxEvent` + the `OutboxEventInput` shape.
- `packages/evidence-ledger/src/outbox/relay-lag.ts` (+ test) — threshold resolution + lag computation.
- `packages/evidence-ledger/src/outbox/outbox-relay.ts` (+ test) — `EventPublisher`/`OutboxStore` interfaces, `InMemoryOutboxStore`, `OutboxRelay`.
- `packages/evidence-ledger/src/outbox/deduping-event-consumer.ts` (+ tested alongside relay) — `event_id` dedup.
- `packages/evidence-ledger/src/outbox/prisma-ledger-writer.ts` (+ integration test) — the atomic producer write.
- `packages/evidence-ledger/src/outbox/prisma-outbox-store.ts` (+ integration test) — the relay's real store.
- `packages/evidence-ledger/src/index.ts` — barrel exports.
- `apps/worker/src/orchestrator/platform-event-emitter.ts` — comment corrected to name `PrismaLedgerWriter` as the real same-transaction mechanism.
- `vitest.config.ts` — the two new Prisma-bound files excluded from the default coverage gate.

## Gate results

```
pnpm typecheck                 → clean, exit 0
pnpm lint                      → clean, exit 0
pnpm test (default gate)       → 73 test files, 620 tests, all passed
coverage (default gate)        → 100% statements/branches/functions/lines, every file in the repo
integration (real Postgres)    → 7 tests passed (3 transactional-writer incl. atomic rollback, 4 relay store),
                                 executed against a live PostgreSQL 16 via DATABASE_URL
```

## Acceptance criteria

- [x] `outbox_event` row inserted in the SAME transaction as the state+evidence write it accompanies (ADR-005, LLD §2) — `PrismaLedgerWriter.persistTransition()` uses one `prisma.$transaction([execution, evidence, outbox])`; a `CRITICAL` integration test proves atomicity by forcing the outbox insert to fail and asserting the execution and evidence rows both rolled back
- [x] A separate relay process publishes and marks `published_at`; consumers dedupe by the stable `event_id`, never the row id — `OutboxRelay` (with a `CRITICAL` failure-retry test) publishes and stamps `published_at`; `DedupingEventConsumer`'s `CRITICAL` test proves exactly-once handling on `event_id` under duplicate delivery
- [x] Relay-lag alert ships with a configurable default threshold of 5 minutes, tenant-overridable (OI-LLD-02) — `DEFAULT_RELAY_LAG_THRESHOLD_MS = 5 min`, `resolveRelayLagThresholdMs()` honors a positive tenant override and falls back to the default otherwise; `computeRelayLag()`/`OutboxRelay.checkLag()` tested at both the unit level and against the real table
