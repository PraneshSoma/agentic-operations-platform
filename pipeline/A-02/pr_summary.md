# A-02: Supporting contracts

**Phase:** A — Contracts
**Depends on:** A-01
**Status:** DONE

## Summary

Adds the remaining domain contracts needed before Build can start on the
orchestration, policy, and execution stories (Phases B–E): `ExecutionState`,
`ContextPackage`, `ActionDefinition`, `ConnectorDescriptor`,
`ExecutionAuthorization`, `PreflightResult`, `OPCMatchResult`, and
`VerificationResult`. Together with A-01's six contracts, `@aop/contracts`
now covers every schema referenced by LLD-v1 §2/§6 and ADR-001 through
ADR-012.

## Process note (auto mode)

This story ran under the auto-mode HIL configuration the user enabled after
A-01 (`hil.planning/codegen/testgen/rfc: false` in `loop.config.json`) —
no per-stage approval was requested. In place of a full `planning_context.json`
(A-01's precedent), this PR summary itself carries the per-contract plan
below for audit-trail parity; a future story can backfill a formal
`planning_context.json` if the team wants strict format parity with A-01.

**Gap caught and closed during this story**: the story queue's acceptance
criteria for A-02 named a fourth field on `VerificationResult` but the
schema itself was not yet in the repo at all (only referenced in LLD-v1 §2
and spec §19). Added `VerificationResultSchema` to close that gap rather
than silently dropping the acceptance criterion.

## Contracts added

| Contract | File | Source | Key additive fields (LLD/ADR) |
|---|---|---|---|
| `ExecutionState` | `execution-state.ts` | spec §11 | `EXECUTION_UNCERTAIN` inserted into `state` enum between `EXECUTING`/`VERIFYING` (ADR-004, LLD §4/gate 5) |
| `ContextPackage` | `context-package.ts` | spec §10 | `stale_context: string[]` (spec §10) |
| `ActionDefinition` | `action-definition.ts` | spec §13 | `compensation_class: REVERSIBLE\|COMPENSATABLE\|IRREVERSIBLE`, `risk_scoring_ref?: string` (ADR-001, ADR-003), plus a `.refine()` enforcing ADR-001's `reversible`↔`compensation_class` consistency rule at the schema level (not just documented) |
| `ConnectorDescriptor` | `connector-descriptor.ts` | spec §10 | `definition_version: string`, `supports_correlation: boolean` (default `false`), `is_idempotent: boolean` (default `false`), `reliability_level: LOW\|MEDIUM\|HIGH\|AUTHORITATIVE` (LLD §2, ADR-004/007, OI-REQ-10) |
| `ExecutionAuthorization` | `execution-authorization.ts` | spec §14A | `identity.mode: SERVICE_ACCOUNT\|ON_BEHALF_OF` restricted to the two authorized modes (LLD §5, ADR-012) |
| `PreflightResult` / `PreconditionSet` | `preflight-result.ts` | spec §14B | `status: MATCH\|DRIFTED\|UNKNOWN` — `UNKNOWN` kept as a real, representable outcome (never an implicit pass) |
| `OPCMatchResult` | `opc-match-result.ts` | spec §6A | `outcome: MATCHED\|AMBIGUOUS_ESCALATE` — no silent auto-pick between close-margin candidates |
| `VerificationResult` | `verification-result.ts` | spec §19 | `checks[].name` constrained to the formal 7-value enum from LLD-v1 §2 (ADR-006), replacing the spec's unconstrained `string` |

All 8 files follow A-01's pattern: spec-literal fields first, additive
LLD/ADR fields inline-commented with their originating section, one Zod
schema + inferred TS type per file, re-exported from `src/index.ts`.

## Tests

8 new `*.test.ts` files (one per schema), extending the A-01 pattern:
valid-payload acceptance, `CRITICAL`-labeled tests for every enum/refine
constraint with a rationale comment tying it to the originating spec/ADR/LLD
section, and `it.each()` missing-required-field coverage via the shared
`omit()`/`structuredClone` helper pattern.

## Gate results (real, not self-reported)

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 15 test files, 170 tests, all passed
pnpm exec vitest run --coverage → 100% stmts/branch/funcs/lines, all files
```

## Acceptance criteria

- [x] `ExecutionState.state` enum includes `EXECUTION_UNCERTAIN` (LLD §4, ADR-004/gate 5)
- [x] `ActionDefinition` includes `compensation_class` (REVERSIBLE\|COMPENSATABLE\|IRREVERSIBLE) + `risk_scoring_ref`, consistency-validated against `reversible` per ADR-001
- [x] `ConnectorDescriptor` includes `definition_version`, `supports_correlation`, `is_idempotent`, `reliability_level` (LLD §2, ADR-004/007, OI-REQ-10)
- [x] `VerificationResult.checks[].name` constrained to the formal enum from LLD §2 (incl. `ROLE_SEPARATED_REVIEW`)
