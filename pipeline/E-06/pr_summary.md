# E-06: Version-binding read view

**Phase:** E — Evidence, confidence, dashboard
**Depends on:** E-01
**Status:** DONE

## Summary

The immutable version binding for replayability (F-20, LLD-v1 §0): given
an `execution_id`, one read view returns every element in the
version-binding table — OPC id/version, action ref/version, policy
version, frozen plan id, approval id, model+prompt version, connector
definition version, executor build hash, and the (F-16-guaranteed)
evidence snapshot — joined from fields that already exist. A read
guarantee only, no new write path (OI-REQ-10's resolution).

## Design decisions

- **A read guarantee, not a new write path.** `buildVersionBindingView()`
  is pure and `PrismaControlTowerRepository.getVersionBinding()` only
  reads and joins — nothing is written, no schema field is added. This is
  exactly what F-20's MVP AC and OI-REQ-10 asked for: capture the
  scattered version fields *together* per execution, as a projection over
  what's already persisted.
- **Extends the existing Control Tower repository** (E-05) rather than a
  new surface — `getVersionBinding()` joins the same execution /
  proposals / policy-decisions / action-executions rows plus connector
  definitions, all tenant-scoped, and returns 404 for a wrong-tenant or
  unknown execution.
- **The two elements without a dedicated table are read from the evidence
  chain, honestly.** Spec §32 defers the `resolution_plan` and `approval`
  tables, so frozen-plan-id and approval-id have no persisted column yet.
  Rather than invent one, the repository reads them from the PLAN /
  APPROVAL evidence records' `structured_data` (`plan_id` / `approval_id`)
  where the orchestrator recorded them — legitimate, since F-16 already
  makes evidence the reconstruction source of truth. The pure builder
  takes them as explicit inputs so it stays total and unit-testable.
- **Connector definition versions come from the context package's
  provenance.** The connectors that assembled an execution's context are
  named in `ContextPackage.provenance`; the repository joins their
  `connector_definition` rows for the pinned `definition_version` —
  OI-REQ-10's version-binding field, read, never recomputed.
- **`evidence_snapshot_reconstructable` is a literal `true`** — the view
  names F-16's guarantee (the full snapshot is reconstructable by
  execution_id) rather than duplicating the whole ledger inline.
- **Same pure/Prisma coverage split.** `buildVersionBindingView` is pure
  and unit-tested at 100%; the Prisma read path is exercised by the
  Control Tower integration suite against live Postgres — **6 control-tower
  integration tests now pass** (E-05's 4 plus this story's 2:
  version-binding assembly and its tenant isolation).

## Files

- `packages/evidence-ledger/src/read/version-binding-view.ts` (+ test) — the view type + pure `buildVersionBindingView`.
- `packages/evidence-ledger/src/read/engineering-context-package-view.ts` — `ControlTowerRepository` interface gains `getVersionBinding`.
- `packages/evidence-ledger/src/read/prisma-control-tower-repository.ts` (+ integration test) — `getVersionBinding` implementation.
- `packages/evidence-ledger/src/index.ts` — barrel export.
- `apps/api/src/routes/control-tower.ts` (+ test) — `GET .../version-binding` route.

## Gate results

```
pnpm typecheck                 → clean, exit 0
pnpm lint                      → clean, exit 0 (zero warnings)
pnpm test (default gate)       → 81 test files, 695 tests, all passed
coverage (default gate)        → 100% statements/branches/functions/lines, every file in the repo
integration (real Postgres)    → 6 control-tower tests passed (incl. version-binding assembly + isolation),
                                 executed against a live PostgreSQL 16 via DATABASE_URL
```

## Acceptance criteria

- [x] Given an execution_id, a single query/view returns every element in LLD §0's version-binding table (F-20) — `getVersionBinding()` + `buildVersionBindingView()`; a `CRITICAL` unit test and a `CRITICAL` real-Postgres integration test assert all nine elements (OPC, action, policy, plan, approval, model, connector version, build hash, evidence-reconstructable) are present
- [x] No new write path — a read guarantee only, per OI-REQ-10's resolution — the view is assembled purely from already-persisted fields (and evidence for the two deferred-table ids); no schema change, no write in the code path
