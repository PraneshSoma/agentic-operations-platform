-- Manual migration (not generated from schema.prisma diffing).
--
-- Prisma's schema DSL has no partial-index syntax, so the
-- @@index([tenant_id, available_at]) on OutboxEvent (schema.prisma)
-- generates a full composite index. LLD-v1 §2 specifies the relay's poll
-- query as:
--   WHERE tenant_id = ? AND available_at <= now() AND published_at IS NULL
-- which only ever needs to scan unpublished rows — a partial index keeps
-- the index small and the poll query fast as the table grows, instead of
-- indexing every already-published row forever.
--
-- Drift note: schema.prisma will keep describing this as a plain
-- @@index — `prisma migrate dev` diffing has no way to represent the
-- WHERE clause, so a future schema-driven migration that touches this
-- index would regenerate it WITHOUT the partial clause. If this index is
-- ever redefined by a generated migration, this WHERE clause must be
-- manually re-added in a follow-up migration, same as here.
DROP INDEX IF EXISTS "outbox_event_tenant_id_available_at_idx";

CREATE INDEX "outbox_event_tenant_id_available_at_idx"
  ON "outbox_event" ("tenant_id", "available_at")
  WHERE "published_at" IS NULL;
