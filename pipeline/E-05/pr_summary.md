# E-05: Control Tower minimal read API

**Phase:** E — Evidence, confidence, dashboard
**Depends on:** E-01, E-02
**Status:** DONE

## Summary

The Control Tower's minimal read surface (F-16, spec §34): an execution's
complete history reconstructed **from Evidence Ledger records alone**, and
the read-only `EngineeringContextPackageView` composite
(`GET .../context-package/composite`, OI-REQ-02) — a read-time join by
`execution_id`, with zero ContextPackage schema change.

## Design decisions

- **History reconstruction takes evidence records as its ONLY input.**
  `buildExecutionHistory(tenantId, executionId, evidence[])` needs no
  other table — it orders the evidence chain and projects each record
  into a timeline entry. That's exactly what spec §34's acceptance bar
  ("reconstructable from Evidence Ledger records alone") means, and it's
  honest because RULE 7 makes every state transition write an evidence
  record, so the ordered evidence chain IS the history. Ordering is by
  `integrity.created_at` with `evidence_id.localeCompare` as a
  deterministic tie-breaker, so reconstruction is reproducible rather
  than clock-jitter-dependent — a dedicated test feeds records in
  scrambled order and asserts a stable chronological result.
- **The composite is a read-time join, not a stored object (OI-REQ-02).**
  `EngineeringContextPackageView` is a derived TypeScript projection
  assembled by joining the rows an execution touched
  (execution + context_package + proposed_actions + policy_decisions +
  verifications + the reconstructed history) by `execution_id` — the same
  join-based pattern Evidence itself uses (§4.6). Nothing is persisted and
  the ContextPackage schema is untouched, exactly as OI-REQ-02 decided.
  The view resolves even when context assembly never ran
  (`context_package: null`), so early-stage executions are still viewable.
- **Pure builder / Prisma edge split, consistent with E-01/E-02.**
  `buildExecutionHistory` and `buildEngineeringContextPackageView` are
  pure and unit-tested at 100% in the default gate.
  `PrismaControlTowerRepository` (the read-time joins + tenant scoping) is
  DB-bound, excluded from the default coverage gate, and verified by a
  `.integration.test.ts` — **4 integration tests executed and passing
  against live PostgreSQL 16**, including the F-16 history-reconstruction
  bar, the OI-REQ-02 composite join, and cross-tenant isolation (a
  wrong-tenant read returns `undefined` even when the execution id
  exists).
- **`ControlTowerRepository` is a pluggable interface**, so the HTTP
  routes are exercised with an in-memory fake (`.inject()` tests) while
  the real Prisma implementation is integration-tested — the same
  seam the status-check route used in D-07.
- **Read routes register only when a repository is supplied.** There's no
  natural in-memory default for a read-over-the-ledger surface, so
  `buildApp()` registers the Control Tower routes only when
  `controlTowerRepository` is passed; a test confirms the routes are
  absent (404) otherwise, so the other route suites stay DB-free.
- **Tenant isolation is enforced at the read boundary**, not assumed:
  every repository method filters by `tenant_id` and the route returns 404
  for a wrong-tenant or unknown execution — never another tenant's data.

## Files

- `packages/evidence-ledger/src/read/execution-history.ts` (+ test) — `buildExecutionHistory`, F-16.
- `packages/evidence-ledger/src/read/engineering-context-package-view.ts` (+ test) — the view type, `ControlTowerRepository` interface, `buildEngineeringContextPackageView`.
- `packages/evidence-ledger/src/read/prisma-control-tower-repository.ts` (+ integration test) — the Prisma read layer.
- `packages/evidence-ledger/src/index.ts` — barrel exports; `vitest.config.ts` — Prisma read repo excluded from default coverage.
- `apps/api/src/routes/control-tower.ts` (+ test) — the two GET routes.
- `apps/api/src/app.ts` — `controlTowerRepository` option, conditional registration; `apps/api/package.json` — `@aop/evidence-ledger` dependency.

## Gate results

```
pnpm typecheck                 → clean, exit 0
pnpm lint                      → clean, exit 0 (zero warnings)
pnpm test (default gate)       → 80 test files, 689 tests, all passed
coverage (default gate)        → 100% statements/branches/functions/lines, every file in the repo
integration (real Postgres)    → 4 tests passed (history reconstruction, composite join, tenant isolation),
                                 executed against a live PostgreSQL 16 via DATABASE_URL
```

## Acceptance criteria

- [x] An execution's complete history reconstructable from Evidence Ledger records alone (F-16, spec §34) — `buildExecutionHistory()` takes only evidence records and produces the ordered timeline; a `CRITICAL` unit test and a `CRITICAL` real-Postgres integration test both feed scrambled-order evidence and assert the full chronological reconstruction
- [x] `GET /tenants/{tenantId}/executions/{executionId}/context-package/composite` implemented (LLD §6, OI-REQ-02) — read-only join, zero ContextPackage schema change — the route + `PrismaControlTowerRepository.getCompositeContextPackage()` return the read-time join; a `CRITICAL` integration test asserts the composite joins execution + proposals + decisions + verifications + history by `execution_id`, and no ContextPackage schema field was added
