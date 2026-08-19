# E-03: Confidence dimensions, itemized (no numeric rollup)

**Phase:** E — Evidence, confidence, dashboard
**Depends on:** D-03, C-03
**Status:** DONE

## Summary

`ConfidenceDimensions` contract + `@aop/confidence`'s
`assembleConfidenceDimensions()`: the five already-defined confidence
dimensions (spec §26, F-17) surfaced individually from existing pipeline
artifacts, with — by construction — no single numeric confidence figure
anywhere.

## Design decisions

- **The "no rollup" rule is enforced structurally, not by convention.**
  `ConfidenceDimensionsSchema` has no top-level `score` / `confidence` /
  `percentage` field and no code path that computes one — the type
  literally cannot hold a collapsed figure. A `CRITICAL` schema test
  asserts the top-level keys are exactly the five dimensions and none of
  the forbidden names; a `CRITICAL` assembler test deep-scans the
  serialized output for `"score"`/`"confidence"`/`"percentage"` and finds
  none. This is F-17's hard gate ("a single numeric figure is only
  displayed once empirically calibrated" — Post-MVP) made unbreakable at
  the contract level, rather than a discipline someone could later
  violate by adding a field.
- **Every dimension is derived from artifacts the pipeline already
  produces** — no new engineering per the Requirements Rev2 table:
  - *evidence_coverage* (HIGH/MEDIUM/LOW) from `InvestigationResult`'s
    observations + diagnosis evidence_ids;
  - *hypothesis_support* (supported/rejected/unresolved counts) from
    `InvestigationResult.hypotheses[].status`;
  - *contradictory_evidence* from the union of
    `Evidence.relationships.contradicts` (§4.6) and hypotheses'
    `contradicting_evidence_ids` (§11), de-duped and sorted;
  - *verification_confidence* from `VerificationResult.checks[].status`;
  - *evidence_freshness* from `ContextPackage`'s `stale_context` /
    `missing_context` (§10).
- **Counts are itemized facts, not a smuggled percentage.** Each
  dimension carries integer counts of the underlying data (backed vs.
  total claims, pass/fail/unknown checks, stale/missing context) — these
  are exactly the itemized facts F-17 wants surfaced, not a derived 0-1
  or 0-100 confidence number. The assembler never divides them into a
  ratio; the categorical (HIGH/MEDIUM/LOW, FRESH/STALE) is the summary,
  the counts are its backing.
- **`verification_confidence` is `NOT_YET_VERIFIED` before the
  Verification Engine has run** — never an implicit "verified", the same
  never-assume-success discipline as D-03's own INCONCLUSIVE default. The
  assembler takes `verification` as optional and surfaces its absence
  explicitly.
- **New `@aop/confidence` package**, mirroring the one-concern-per-package
  pattern (policy-engine, verification-engine). Pure and deterministic —
  unit-tested at 100% in the default gate, no I/O, no DB.

## Files

- `packages/contracts/src/schemas/confidence-dimensions.ts` (+ test) — the itemized `ConfidenceDimensions` contract.
- `packages/contracts/src/index.ts` — barrel export.
- `packages/confidence/{package.json,tsconfig.json}` — new package.
- `packages/confidence/src/assemble-confidence-dimensions.ts` (+ test) — the assembler.
- `packages/confidence/src/index.ts` (+ barrel-coverage test).
- `tsconfig.json` (root) — project reference added.
- `packages/evidence-ledger/src/outbox/outbox-relay.test.ts` — incidental lint cleanup (removed an unnecessary eslint-disable directive left from E-02; behavior unchanged).

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0 (zero warnings)
pnpm test        → 76 test files, 651 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] All 5 already-defined dimensions surfaced individually, never collapsed into one figure (F-17 MVP) — `assembleConfidenceDimensions()` returns the five named dimensions; per-dimension tests verify each derives correctly from its source contract
- [x] No numeric confidence percentage is displayed anywhere — the itemized dimensions are the entire confidence surface — `CRITICAL` tests at both the schema level (top-level keys are exactly the five dimensions; no score/confidence/percentage) and the assembler level (serialized output scanned for those names, none present); the contract has no field capable of holding a rollup
