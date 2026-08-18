# B-06: Planner agent integration + Frozen Plan Rule

**Phase:** B — Happy-path runtime (last story — Phase B complete)
**Depends on:** B-05
**Status:** DONE

## Summary

New `packages/action-executor` package (first story to need it — the
ActionConnector interface itself lands in D-01). Implements spec §12's
Planner Agent (mirroring B-05's Investigator structure) and, as the
story's real center of gravity, `assertMatchesFrozenPlan()` — spec §12's
Frozen Plan Rule enforcement.

## Contract gap closed

`ResolutionPlanSchema` (spec §12) — same pattern as every prior gap this
session (`VerificationResult`, `PlatformEvent`, `InvestigationResult`):
referenced by this story, had no schema anywhere yet.

## Design decisions

- **Planner input is narrowed from spec §12's four listed inputs to
  three.** `InvestigationResult` + `OperationalProcedureContract` +
  `availableActions: readonly ActionDefinition[]` — spec §12 also lists
  "Action Registry" and "Tenant Policy" as inputs, but a proper Action
  Registry interface is C-02's job and tenant-policy-aware planning
  constraints are C-03's; neither contract exists yet, and guessing their
  shape now would risk reworking this call site later. `availableActions`
  is what B-06's two acceptance criteria actually need.
- **`UnregisteredActionError`** — the Planner-side analogue of the
  Investigator's evidence-grounding check: an ACTION step's `action_ref`
  must be one of the actions actually passed in, or the whole plan is
  rejected. Not named in B-06's acceptance criteria explicitly, but a
  direct structural parallel to spec §11's "may not invent" rule applied
  to spec §12's registry input.
- **`assertMatchesFrozenPlan()` is a standalone, pure guard function**,
  not folded into an executor class — D-01's `ActionConnector`
  implementations and the Engineering-Change executor (ADR-002) both need
  this same discipline, so it's callable from either without a shared base
  class. It throws on two distinct violations, never silently proceeding
  on either:
  - `UnapprovedActionError` — the requested `step_id` isn't in the
    approved plan at all (an added step), or its `action_ref` doesn't
    match the frozen step's (a substituted action). Covers F-06's
    "cannot add or substitute an action outside the approved plan"
    directly.
  - `ParameterChangedError` — the requested parameters aren't deep-equal
    to the approved step's frozen parameters (a real recursive deep-equal,
    not string/JSON comparison — key order never matters, nested
    objects/arrays are compared structurally). Carries both the approved
    and requested parameters on the error for audit.
  - Only ACTION-type steps are meant to be frozen (spec §12 explicitly
    permits additional read-only verification if policy allows) — the
    guard itself doesn't special-case step type; distinguishing which
    steps to gate is the executor's call-site responsibility, documented
    explicitly in the function's own doc comment.

## Files

- `packages/contracts/src/schemas/resolution-plan.ts` (+ test).
- `apps/worker/src/agents/planner.ts` (+ test).
- `packages/action-executor/src/frozen-plan-guard.ts` (+ test) — the core of this story.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 39 test files, 318 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] After approval, executor cannot add/substitute an action outside the approved plan (F-06) — two `CRITICAL`-labeled tests: an added step_id, and a substituted action_ref on a known step
- [x] A changed parameter on an approved step forces re-approval, never silently proceeds — `ParameterChangedError` thrown (not returned/logged) on value change, added key, and removed key, plus nested-object/array structural comparison
