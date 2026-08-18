# D-03: Verification Engine

**Phase:** D — Execution (simulated)
**Depends on:** D-01
**Status:** DONE

## Summary

New package `packages/verification-engine`: `runVerification()` — spec
§19's mandatory post-execution decision policy. "Execution success does
not equal resolution success": a mutating action can report `SUCCESS`
from `ActionConnector.execute()` and still fail to actually resolve the
incident, so verification is a separate, mandatory gate with its own
`overall` verdict and `recommended_next_step`.

## Design decisions

- **New dedicated package, not folded into `action-executor`** — mirrors
  the existing separation between `policy-engine` (a governance decision)
  and `action-executor` (mechanics): verification is a governance
  decision made *about* an execution, not a capability of the connector
  that performed it. It depends only on `@aop/contracts` and `zod`, same
  shape as `policy-engine`.
- **Per-check evaluation is explicitly out of this story's scope, and
  says so in the code.** The OPC contract's `verification.checks[]`
  carries a free-form `success_condition: string` (spec §4.2). Spec §4.2
  is explicit that an OPC must never contain executable arbitrary code —
  evaluating that string as an expression would mean running
  tenant-authored data as code, which is exactly what that rule forbids.
  `runVerification()` therefore takes already-evaluated
  `VerificationCheckInput[]` (name/status/evidence_ids) as input, the
  same shape as spec §19's `VerificationResult.checks[]` minus the
  aggregation fields — the actual per-check read-and-compare (a connector
  operation, analogous to D-01/D-02's `PreconditionSet` checks) is left
  to the caller. This engine owns only the one thing spec §19/§20/§30
  actually mandate as *policy*: aggregating checks into a verdict and
  deriving the one recommended next step that verdict allows.
- **Empty `checks[]` is treated as INCONCLUSIVE, never an implicit
  VERIFIED pass** — same "never assume success" discipline used
  throughout this codebase (B-05's evidence-grounding, D-01/D-02's
  preflight UNKNOWN handling). A verification with nothing to verify has
  no basis for closing anything.
- **INCONCLUSIVE always escalates, unconditionally — never ROLLBACK,
  regardless of compensation_class.** This is spec §30's explicit
  Failure Handling entry ("Verification inconclusive -> ESCALATE. Do not
  mark ticket resolved.") and is deliberately NOT folded into the same
  branch as FAILED: an inconclusive result gives no evidence a rollback
  is even warranted, so treating it as "FAILED-but-maybe-fixable" would
  be inventing a justification the verification never actually produced.
- **ROLLBACK is gated on `compensation_class`, not the boolean
  `reversible` flag** — per this story's acceptance criteria and F-14's
  three-way split (ADR-001): `REVERSIBLE`/`COMPENSATABLE` actions may be
  offered ROLLBACK on FAILED; `IRREVERSIBLE` actions always ESCALATE
  instead, since there's no rollback path to offer at all.
- **Aggregation precedence is FAIL > UNKNOWN > (all PASS)** — a single
  failed check makes the whole verification FAILED even if other checks
  are UNKNOWN; a definite failure is a stronger signal than an
  indeterminate one and shouldn't be softened to INCONCLUSIVE.

## Files

- `packages/verification-engine/package.json`, `tsconfig.json` — new package, same shape as `policy-engine`.
- `packages/verification-engine/src/run-verification.ts` (+ test) — the core of this story.
- `packages/verification-engine/src/index.ts` (+ barrel-coverage test).
- `tsconfig.json` (root) — added the new package's project reference.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 58 test files, 476 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] FAILED/INCONCLUSIVE never marks the ticket resolved (F-13) — `CRITICAL`-labeled tests assert `recommended_next_step` is never `CLOSE` for either outcome; only `VERIFIED` ever produces `CLOSE`
- [x] recommended_next_step always populated (CLOSE/ROLLBACK/ESCALATE) — the function has no code path that omits it; `VerificationResultSchema.parse()` enforces the field is present and one of the three enum values on every return
- [x] ROLLBACK is only ever recommended for REVERSIBLE/COMPENSATABLE actions, never IRREVERSIBLE ones — `CRITICAL`-labeled test: FAILED + IRREVERSIBLE asserts ESCALATE, never ROLLBACK; separate tests confirm ROLLBACK for both REVERSIBLE and COMPENSATABLE
