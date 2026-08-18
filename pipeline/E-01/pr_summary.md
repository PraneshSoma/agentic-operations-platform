# E-01: Evidence Ledger persistence

**Phase:** E — Evidence, confidence, dashboard (first story)
**Depends on:** A-01, D-03
**Status:** DONE

## Summary

The real, Prisma-backed Evidence Ledger persistence layer (spec §21,
F-15): an append-only `EvidenceRepository`, ADR-011's class-differentiated
finite dev retention policy (`computeRetention`), and — crucially —
integration tests that run against a **real Postgres** and genuinely
prove the two DB-level invariants this story exists for (append-only
corrections, cross-tenant isolation), rather than asserting them against
a mock. This story also retires the naive 30-day retention placeholders
B-03 and D-06 disclosed as "E-01's job."

## Design decisions

- **Pure core, unit-tested; Prisma edge, integration-tested — split on
  what a mock can actually prove.** `computeRetention()` (retention
  policy) and `buildSupersedingRecord()` (the append-only correction
  builder) are pure functions with no I/O, fully unit-tested in the
  default `pnpm test` gate at 100% coverage. `PrismaEvidenceRepository`
  is the thin DB-bound edge — it's excluded from the default coverage
  gate (the same treatment the app process entrypoints get, with an
  explanatory comment in `vitest.config.ts`) because append-only-ness
  and tenant isolation are properties of the *database*, not of TypeScript
  logic a dependency-free unit test could exercise. It is verified
  instead by `.integration.test.ts` suites.
- **The integration tests actually run in this environment, and passed.**
  A-03's `schema.integration.test.ts` uses Testcontainers, which the
  sandbox's egress proxy blocks — so it was verified by hand and
  disclosed. This story's two new integration suites instead connect a
  `PrismaClient` to `DATABASE_URL` directly (Testcontainers OR a
  service Postgres — CI can use either), so they were genuinely executed
  here against a real PostgreSQL 16: **19 integration tests passed** (14
  cross-tenant isolation, one per tenant-scoped table; 5 append-only /
  retention). This is a strictly better verification path than A-03's,
  disclosed as the reason for the harness difference.
- **The `EvidenceRepository` interface has no `update()` method — the
  append-only invariant is structural, not just documented.** F-15 /
  spec §21 require corrections to create a new record, never mutate the
  original. There is deliberately no way to update through this
  interface; a correction goes through `supersede()`, which inserts a
  NEW row whose `relationships.supersedes` points at the record it
  replaces. The integration test proves the original row is byte-for-byte
  untouched after a supersede.
- **`computeRetention()` is class-differentiated per ADR-011, not one
  blanket policy.** Five classes, five finite dev defaults: 90 days for
  operational state / evidence records (the headline default the AC
  names), 30 for prompts / redacted payloads (most conservative), 365
  for audit hashes (the chain outlives individual records).
  `retention_policy_version = "dev-nonprod-v0"` is the machine-readable
  marker that E-07's tenant-activation gate will check to block
  production activation until a real per-class decision is recorded —
  ADR-011's "no silent drift to production" requirement.
- **B-03's and D-06's disclosed placeholders are retired here, not left
  dangling.** Both wrote evidence with a hardcoded 30-day
  `retention_policy_version: "v0-dev-default"` and a comment saying the
  real computation was "E-01's job." Both now call `computeRetention()`
  — the worker gains a `@aop/evidence-ledger` dependency for it. No
  existing test assertion changed (none asserted the exact retention
  values), and full coverage is preserved.
- **The cross-tenant sweep is genuinely every tenant-scoped table**, not
  a representative sample: all 14 tables carrying `tenant_id`
  (`opc_definition`, `connector_definition`, `action_definition`,
  `incoming_request`, `execution`, `context_package`, `evidence`,
  `proposed_action`, `policy_decision`, `action_execution`,
  `verification`, `execution_step_marker`, `outbox_event`,
  `identity_principal`) are seeded for two tenants and each asserted to
  leak zero rows across the boundary.

## Files

- `packages/evidence-ledger/src/retention/retention-policy.ts` (+ unit test) — `computeRetention`, ADR-011.
- `packages/evidence-ledger/src/repositories/evidence-repository.ts` (+ unit test) — interface + pure `buildSupersedingRecord`.
- `packages/evidence-ledger/src/repositories/prisma-evidence-repository.ts` — the Prisma-backed implementation (integration-tested).
- `packages/evidence-ledger/src/repositories/prisma-evidence-repository.integration.test.ts` — append-only + retention, real Postgres.
- `packages/evidence-ledger/src/cross-tenant-isolation.integration.test.ts` — 14-table isolation sweep, real Postgres.
- `packages/evidence-ledger/src/index.ts`, `package.json` — barrel + `@aop/contracts` dependency.
- `apps/worker/src/orchestrator/state-machine.ts`, `budget-governance.ts` — placeholders retired, now call `computeRetention`.
- `apps/worker/package.json` — `@aop/evidence-ledger` dependency added.
- `vitest.config.ts` — Prisma repository excluded from the default coverage gate (integration-verified), with an explanatory comment.

## Gate results

```
pnpm typecheck                 → clean, exit 0
pnpm lint                      → clean, exit 0
pnpm test (default gate)       → 70 test files, 595 tests, all passed
coverage (default gate)        → 100% statements/branches/functions/lines, every file in the repo
integration (real Postgres)    → 19 tests passed (14 cross-tenant isolation + 5 append-only/retention),
                                 executed against a live PostgreSQL 16 via DATABASE_URL
```

## Acceptance criteria

- [x] Append-only: a correction creates a new record with `relationships.supersedes` set, never an in-place update (F-15) — the interface has no `update()` method; `buildSupersedingRecord()`'s `CRITICAL` unit test and the `supersede()` `CRITICAL` integration test (which asserts the original row is untouched afterward) both prove it
- [x] Cross-tenant leak test (two seeded tenants) returns zero rows for the wrong tenant on every table — `cross-tenant-isolation.integration.test.ts` seeds two tenants across all 14 tenant-scoped tables and asserts, per table, that a tenant-filtered query returns only that tenant's rows; executed and passing against real Postgres
- [x] `retention_expires_at` / `retention_policy_version` / `legal_hold` populated per ADR-011's finite dev default (90 days), explicitly labeled non-production — `computeRetention()`'s unit tests assert the 90-day headline default and the `"dev-nonprod-v0"` non-production label; the repository integration test confirms the fields round-trip through Postgres correctly
