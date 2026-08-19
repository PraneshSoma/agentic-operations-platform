# E-04: Role-separated review + source-reliability + policy-certainty dimensions

**Phase:** E — Evidence, confidence, dashboard
**Depends on:** E-03
**Status:** DONE

## Summary

Completes the confidence surface: a context-isolated **role-separated
review** mechanism (ADR-006) feeding the Verification checks, plus the
two confidence dimensions the Requirements Rev2 table left "undefined
(OI-REQ-08/09)" — **source reliability** (ordinal, ADR-007) and **policy
certainty** (categorical, ADR-008). The itemized confidence surface grows
from five dimensions to seven, still with no numeric rollup anywhere.

## Design decisions

- **Context isolation is enforced by the type, not by discipline.**
  `RoleSeparatedReviewInputSchema` has exactly four fields — `frozen_plan`,
  `proposed_change`, `test_results`, `evidence_ids` — and NO
  `reasoning_transcript` / `chain_of_thought` / `diagnosis_reasoning`
  field. The reviewer literally cannot be handed the generator's
  chain-of-thought, because there is no field to carry it. A `CRITICAL`
  test enumerates the schema's keys and asserts none of the forbidden
  names is present. This is ADR-006's whole point — "the difference
  between reviewing the work and re-reading the same explanation and
  agreeing with it" — made structural.
- **Terminology is enforced, never "independent."** The check name is the
  formal enum value `ROLE_SEPARATED_REVIEW` (already in A-02's
  `VerificationCheckName`), and the single user-facing label a UI would
  pull is `ROLE_SEPARATED_REVIEW_LABEL = "Role-separated review"`. A
  `CRITICAL` test asserts both never contain "independent" — ADR-006 is
  explicit that calling a same-model-family pass "independent"
  overstates the signal.
- **The reviewer is pluggable; the MVP ships a transparent simulated
  one.** `RoleSeparatedReviewer` is an interface (real deployments
  register genuine model diversity — ADR-006's Extension point, the thing
  that would actually earn the word "independent"). `SimulatedRoleSeparated
  Reviewer` has a transparent, testable rule (FAIL on any failed shown
  test; UNKNOWN on unresolved checks or no evidence; else PASS) and
  reasons only over what it was given.
- **Source reliability is ordinal, keyed per source, never a decimal
  (ADR-007).** `source_reliability.per_source` lists
  `(connector_id, connector_version, reliability_level)` — ADR-007's
  `(tenant, connector_definition, connector_version)` granularity, not a
  global type-level lookup — and `lowest` is the honest ordinal
  worst-case (a `min` over the LOW<MEDIUM<HIGH<AUTHORITATIVE order), never
  an averaged number. A `CRITICAL` test proves `lowest` of
  {AUTHORITATIVE, LOW, HIGH} is `LOW`, not a blended middle.
- **Policy certainty is categorical; DENY stays DENY (ADR-008).**
  `policy_certainty.outcome` passes `PolicyDecision.outcome` through
  verbatim, with `hard_deny_reason_code` riding along on a DENY. A
  `CRITICAL` test proves a DENY surfaces as `outcome: "DENY"` (with its
  reason code), never remapped to a "low confidence" figure — ADR-008's
  exact concern. `NOT_YET_EVALUATED` before policy runs, never an
  implicit ALLOW.
- **The surface stays rollup-free at seven dimensions.** E-03's "no
  numeric rollup" invariant is preserved: both new dimensions are
  categorical/ordinal, and the schema's `CRITICAL` key-scan test (updated
  from five keys to seven) still confirms no `score`/`confidence`/
  `percentage` field exists. E-03's assembler and schema tests were
  updated to the seven-dimension surface — disclosed here, additive.

## Files

- `packages/confidence/src/role-separated-review.ts` (+ test) — the reviewer input (context-isolated), interface, simulated reviewer, `runRoleSeparatedReview`, terminology constants.
- `packages/contracts/src/schemas/confidence-dimensions.ts` — `source_reliability` + `policy_certainty` added.
- `packages/confidence/src/assemble-confidence-dimensions.ts` — assembler extended with the two new dimensions (new optional `connectorDescriptors` / `policyDecision` inputs).
- `packages/confidence/src/index.ts` — barrel export; `packages/confidence/package.json` — `zod` dependency.
- `packages/contracts/src/schemas/confidence-dimensions.test.ts`, `packages/confidence/src/assemble-confidence-dimensions.test.ts` — E-03 tests updated to the seven-dimension surface + new-dimension coverage.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0 (zero warnings)
pnpm test        → 77 test files, 675 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Role-separated reviewer receives only frozen plan + diff + tests + evidence — explicitly NOT the generator's reasoning transcript (ADR-006) — `RoleSeparatedReviewInputSchema` has exactly those four fields and no transcript field; a `CRITICAL` key-scan test enforces it
- [x] Never described as "independent review" — "role-separated" terminology enforced — `CRITICAL` test on `ROLE_SEPARATED_REVIEW_LABEL` and the check name; both avoid "independent", the check name is the formal `ROLE_SEPARATED_REVIEW` enum
- [x] Source reliability keyed to (tenant, connector_definition, connector_version), ordinal LOW|MEDIUM|HIGH|AUTHORITATIVE, not decimals (ADR-007) — `source_reliability.per_source` carries the per-connector ordinal keyed by (connector_id, connector_version); `lowest` is a `CRITICAL`-tested ordinal min, never a decimal
- [x] Policy certainty is categorical from PolicyDecision.outcome — DENY never displayed as merely "low confidence" (ADR-008) — `policy_certainty.outcome` is the categorical passthrough; a `CRITICAL` test proves DENY stays DENY with its reason code, and there is no numeric field it could be flattened into
