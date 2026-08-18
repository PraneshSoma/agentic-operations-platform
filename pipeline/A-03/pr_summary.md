# A-03: New LLD tables' contracts

**Phase:** A — Contracts
**Depends on:** A-02
**Status:** DONE

## Summary

Establishes the initial `packages/evidence-ledger` Prisma schema (spec §32
relational core) — since no `schema.prisma` existed yet in the repo, this
story creates the base schema covering every table backed by an existing
`@aop/contracts` shape (A-01 + A-02), applies LLD-v1 §2's changed-table
deltas, and adds the three new LLD-v1 §2 tables this story names:
`execution_step_marker`, `outbox_event`, `identity_principal`.

## Scope decision (disclosed)

Spec §32's "suggested relational core" also lists `execution_state_history`,
`investigation`, `resolution_plan`, `approval`, `rollback`, `outcome`, and
`policy_definition`. None of these are modeled in this migration —
no Zod contract yet defines their shape (no `PolicyRule`, no
`Investigation`/`ResolutionPlan`/`Approval`/`Rollback`/`Outcome` schema
exists in `@aop/contracts`), and guessing a persisted shape ahead of the
story that actually defines the contract would risk a shape that has to be
reworked. Each is added additively, by the Build story that defines its
contract: `policy_definition`/`PolicyRule` by C-03 (Policy Engine),
`investigation`/`resolution_plan` by B-05/B-06, `approval` by C-04,
`rollback`/`outcome` by D-04.

## Data model

15 Prisma models, all additive against spec §32:

- **Definition/registry tables** (`opc_definition`, `connector_definition`,
  `action_definition`) — versioned, `@@unique([tenant_id, *_id, version])`,
  carry every LLD-v1 §2 additive field already present in the corresponding
  A-01/A-02 Zod schema (`compensation_class`, `definition_version`,
  `reliability_level`, etc.).
- **Runtime flow tables** (`incoming_request`, `execution`,
  `context_package`, `evidence`, `proposed_action`, `policy_decision`,
  `action_execution`, `verification`) — one per A-01/A-02 contract, nested
  object/array shapes stored as `Json` (the Zod schema is already the
  validated shape at the application boundary; Prisma's job here is
  durable, tenant-indexed storage, not a second relational decomposition).
- **New LLD-v1 §2 tables** (story A-03):
  - `execution_step_marker` — `UNIQUE(tenant_id, execution_id, step_id, operation_id)`, matches LLD §2 exactly, verified present in the actual migrated database (see Verification below).
  - `outbox_event` — `event_id` distinct from the internal `id` PK with its own `UNIQUE` constraint, `aggregate_type`/`aggregate_id`/`aggregate_version`, `event_schema_version`, `available_at`.
  - `identity_principal` — `roles: String[]`, `is_development_principal: Boolean @default(false)`.

**tenant_id on storage-only columns**: `policy_decision`, `action_execution`
(backs `ExecutionResult`), and `verification` (backs `VerificationResult`)
carry a `tenant_id` column even though their Zod contract has no such wire
field — CONTEXT.md RULE 4 requires every table support a direct tenant-scoped
query, not just a join through a parent row. This is a storage-layer
addition only; it does not change the ACCEPTED Zod schemas.

**Enums**: every fixed Zod enum is mirrored as a Postgres enum (DB-level
defense in depth — `@aop/contracts` stays the single source of truth for
validation at the application boundary).

## Manual migration: outbox_event's partial relay index

LLD-v1 §2 specifies the relay's poll query as
`WHERE tenant_id = ? AND available_at <= now() AND published_at IS NULL`.
Prisma's schema DSL has no partial-index syntax, so `@@index([tenant_id,
available_at])` generates a full composite index. A second, hand-written
migration (`20260818104100_outbox_event_partial_relay_index`) drops and
recreates it with `WHERE published_at IS NULL`, keeping the index scoped to
unpublished rows as the table grows. This is a documented, deliberate schema
drift between `schema.prisma` (which can only express the plain index) and
the actual DB index — the migration file itself explains the tradeoff and
what to do if a future schema-driven migration ever regenerates this index.

## Verification (real, not self-reported)

Ran against a real local PostgreSQL 16 server (installed via `apt`, same
workaround established in A-01/A-02 — see below):

```
pnpm exec prisma migrate dev --name init            → applied cleanly
psql -f .../outbox_event_partial_relay_index/migration.sql → applied cleanly
pnpm exec prisma migrate resolve --applied ...       → recorded in _prisma_migrations
pnpm exec prisma generate                            → client generated
```

`\d` against the live database confirms all three new tables exactly match
LLD-v1 §2:
- `execution_step_marker`: `UNIQUE, btree (tenant_id, execution_id, step_id, operation_id)` — present.
- `outbox_event`: `UNIQUE, btree (event_id)` plus `btree (tenant_id, available_at) WHERE published_at IS NULL` — present.
- `identity_principal`: `roles text[]`, `is_development_principal boolean ... default false` — present.

A throwaway Node script (not committed) ran the exact same 7 assertions the
checked-in integration test makes — duplicate-key rejection on
`execution_step_marker`'s and `outbox_event`'s unique constraints,
`ATTEMPTED → COMPLETED` transition, `roles[]` round-trip, and
`is_development_principal` default/override — all passed against the real
database. Full transcript of both the psql `\d` output and the Node script's
PASS lines is in this story's conversation record.

## Docker/Testcontainers disclosure

CONTEXT.md's stated test stack is `@testcontainers/postgresql`. A real
integration test (`packages/evidence-ledger/src/schema.integration.test.ts`)
is checked in using it, and is the authoritative check in any environment
with a reachable container registry. In this sandboxed session, the
container registry (`production.cloudfront.docker.com`) is blocked by the
egress proxy — confirmed by actually running it:

```
Error: (HTTP code 404) no such container - No such image: testcontainers/ryuk:0.14.0
```

This is the same limitation disclosed during A-01. The integration test is
excluded from the default `pnpm test` gate (renamed pattern
`*.integration.test.ts`, `vitest.config.ts` updated) and runs via a new
`pnpm test:integration` script — so the fast default gate stays
dependency-free while the real DB-backed suite exists, is correct, and will
run in any CI with a working container runtime.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 15 test files, 170 tests, all passed (integration test correctly excluded)
pnpm test:integration → fails only on the disclosed Docker-registry block above
```

## Acceptance criteria

- [x] `execution_step_marker` schema matches LLD §2 exactly, including the `UNIQUE(tenant_id, execution_id, step_id, operation_id)` constraint — verified live against real Postgres
- [x] `outbox_event` schema matches LLD §2's full field list (`event_id` distinct from row `id`, `aggregate_type`/`id`/`version`, `event_schema_version`, `available_at`) — verified live
- [x] `identity_principal` includes `is_development_principal`, `roles[]` — verified live
- [x] Prisma `schema.prisma` updated additively; migration generated and reviewed (two migrations: `init`, and the hand-written partial-index follow-up, both applied and recorded)
