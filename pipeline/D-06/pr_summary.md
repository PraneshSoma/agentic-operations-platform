# D-06: Token & cost governance / budget enforcement

**Phase:** D — Execution (simulated)
**Depends on:** B-03
**Status:** DONE

## Summary

`apps/worker/src/orchestrator/budget-governance.ts`: `checkBudget()` — a
pure comparison of `ExecutionState.budget_consumed` against the matched
OPC's `budget` block (spec §4.2) — and `enforceBudget()`, which acts on
that comparison per spec §7B: escalate by default, never silently
truncate.

## Design decisions

- **Four dimensions checked, matching the OPC budget block exactly**:
  `investigation_tokens`, `planning_tokens`, `tool_calls` (all read from
  `ExecutionState.budget_consumed`), plus `wall_clock_minutes` (derived
  from `now - execution.created_at`, since there's no dedicated
  wall-clock counter field to compare directly). Strictly-greater-than:
  consuming exactly the ceiling is still within budget.
- **`checkBudget()` is pure** — no I/O, no state mutation, testable in
  isolation with an injected `now`. Same shape as this codebase's other
  decision engines (Policy Engine, Verification Engine): a pure
  comparison function plus a thin orchestration wrapper that acts on it.
- **`ALLOWED_TRANSITIONS` (B-03) gains `ESCALATED` as a target from
  `CONTEXT_ASSEMBLY`, `PLANNED`, and `EXECUTING`.** Spec §7B says budget
  is "checked at each state transition," and overage is genuinely
  detectable while an execution sits in any of those three states (tool
  calls during `EXECUTING`, wall-clock during `CONTEXT_ASSEMBLY`,
  planning tokens on the way out of `PLANNED`) — the original graph only
  allowed `ESCALATED` from states earlier stories happened to need it
  from. Without this, `enforceBudget()` calling `transitionTo()` from one
  of those three states would hit "Illegal transition" and throw instead
  of escalating — a structural failure of this story's own first
  acceptance criterion in exactly the states most likely to trigger it.
- **`STOP_AND_SUMMARIZE` returns a distinct outcome, never silently
  no-ops.** Actually producing a partial summary requires an LLM call
  over whatever investigation/planning happened so far — an agent-level
  capability this codebase doesn't have and this story's two acceptance
  criteria don't ask for. `enforceBudget()` returns
  `REQUIRES_SUMMARIZATION` instead of performing a state transition, so
  a caller can never mistake "budget exceeded, summarization pending"
  for "nothing happened." The first acceptance criterion's "never
  silently truncates" is honored for both `on_exceeded` values, not just
  the default `ESCALATE` — disclosed explicitly in the code comment.
- **Every `enforceBudget()` call writes exactly one Evidence record**,
  satisfying the second acceptance criterion on every path without
  duplicating writes: the `ESCALATE` path's own state-transition Evidence
  record (RULE 7) already carries the budget snapshot in its
  `structured_data`, so no separate write happens there; the
  `WITHIN_BUDGET` and `STOP_AND_SUMMARIZE` paths don't trigger a state
  transition at all, so a standalone Evidence record is written directly.

## Files

- `apps/worker/src/orchestrator/budget-governance.ts` (+ test) — the core of this story.
- `apps/worker/src/orchestrator/state-machine.ts` — `ALLOWED_TRANSITIONS` extended (3 new edges to `ESCALATED`).
- `apps/worker/src/index.ts` — barrel export added.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 62 test files, 521 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] An execution exceeding its OPC-configured budget escalates with `BUDGET_EXCEEDED`, never silently truncates (F-12) — `CRITICAL`-labeled tests for both `on_exceeded` values: `ESCALATE` transitions to `ESCALATED` with `escalation_reason: BUDGET_EXCEEDED` in the Evidence record; `STOP_AND_SUMMARIZE` returns an explicit `REQUIRES_SUMMARIZATION` outcome rather than a silent no-op
- [x] Budget consumption written to the Evidence Ledger per execution — every `enforceBudget()` call writes exactly one Evidence record on every outcome path (verified by dedicated tests for `WITHIN_BUDGET`, `ESCALATED`, and `REQUIRES_SUMMARIZATION`)
