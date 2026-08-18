# A-01 — Core domain contracts

**Initiative:** AOP-001 (Agentic Operations Platform) · **Phase:** 3 (Build) · **Story type:** CONTRACT

## Summary

Introduces the six foundational Zod contracts every downstream package
builds against: `IncomingRequest`, `OperationalProcedureContract`,
`ProposedAction`, `PolicyDecision`, `ExecutionResult`, `Evidence`. Every
field traces to spec §4's YAML; every LLD-v1/ADR-additive field
(`ProposedAction.accountable_principal_id`, the 5-component `blast_radius`,
`PolicyDecision.hard_deny_reason_code`/`hard_deny_detail`/
`requires_proposer_approver_separation`, `ExecutionResult.executor_build_hash`,
`Evidence.retention_expires_at`/`retention_policy_version`/`legal_hold`) is
kept in a separate `additive_fields` list in the planning context and
commented in code, so nothing gets mistaken for spec-literal content later.

## Changes

**Schema (Zod contracts):**
- `packages/contracts/src/schemas/incoming-request.ts` — new
- `packages/contracts/src/schemas/operational-procedure-contract.ts` — new
- `packages/contracts/src/schemas/proposed-action.ts` — new
- `packages/contracts/src/schemas/policy-decision.ts` — new
- `packages/contracts/src/schemas/execution-result.ts` — new
- `packages/contracts/src/schemas/evidence.ts` — new
- `packages/contracts/src/index.ts` — barrel updated to re-export all six; pre-existing scaffold export retained (harmless, unreferenced by new code)

**Config:**
- `package.json` — added `@vitest/coverage-v8` devDependency (was configured in `vitest.config.ts` at scaffold time but never installed; needed to actually measure the coverage AC)

## Behaviour / rules

No idempotency rule, feature flag, or runtime error-handling path applies —
this story is pure contract definition, no logic beyond schema + type.
`Evidence.retention_class` is constrained to the 5 named classes from
LLD-v1 §2/ADR-011 rather than a free string; `PolicyDecision.outcome` is
constrained to the three-valued `ALLOW | REQUIRE_APPROVAL | DENY` per
ADR-008's correction, with `DENY` verified as a genuinely acceptable value,
not just "not rejected."

## Testing

- **114 tests** across 7 files (6 new + the pre-existing scaffold test, untouched).
- **Coverage: 100%** (statements/branches/functions/lines) on every new file — exceeds both the 85% (governance-critical) and 70% (elsewhere) bars in `testgen.md`.
- **Critical-invariant tests present**, per `testgen.md`'s CONTRACT-story convention:
  - `PolicyDecisionSchema`: DENY accepted as first-class (ADR-008's core correction, tested directly, not just inferred from "invalid values rejected").
  - `EvidenceSchema`: `retention_class` rejects anything outside the 5 named values (ADR-011).
  - Wrong-enum-value rejection tested per schema for every semantically load-bearing enum.
  - Missing-required-field rejection, table-driven, across every required field per schema (not spot-checked).
- **Real test-command result:** `pnpm typecheck` / `pnpm lint` / `pnpm test` all green. One self-heal cycle during Testgen (a `noUncheckedIndexedAccess` TypeScript error in the shared test helper — vitest's own execution didn't catch it, `tsc -b --noEmit` did), fixed and re-verified.

## Open Items Referenced

- Noted in planning (not a defect, a scope boundary): `ContextPackage`/`HistoricalEvidenceContext` are adjacent to `Evidence` but explicitly out of A-01's scope — they belong to A-02.

## Downstream Stories Unblocked

`A-02`, `A-03`, `A-04`, `B-01`, `B-02`, `C-03` — all now have the base contracts they need.

## Progress

**1 / 43 stories complete.** 33 `PENDING`, 8 `BLOCKED` (real-pilot/scoring-grammar items, unaffected by this story), 1 `DEFERRED` (time-gated, unaffected).

## Checklist

- [x] Real test gate green (`pnpm typecheck && pnpm lint && pnpm test`), not self-reported
- [x] Coding rules verified: RULE 1 (Zod schema + inferred type, no duplicated interfaces) — every contract follows this exactly
- [x] No hardcoded credentials/URLs/secrets anywhere in schema or test files
- [x] No feature flag applicable (pure contract definition)
- [x] No rollback applicable (no runtime behavior introduced)
- [x] Reviewer sign-off before merge — **pending your APPROVE at this gate**
