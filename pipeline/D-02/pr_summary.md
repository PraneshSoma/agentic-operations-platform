# D-02: Preflight/drift check

**Phase:** D — Execution (simulated)
**Depends on:** D-01
**Status:** DONE

## Summary

`packages/action-executor/src/gated-execution.ts` (+ test): `runGatedExecution()`
— the structural enforcement point for spec §14B / F-10 ("preflight
runs immediately before every execute() call"). D-01 already gave
`SimulatedActionConnector` real MATCH/DRIFTED/UNKNOWN detection in
`preflight()`, but nothing forced a caller to run it before `execute()`,
or to stop when it comes back anything other than `MATCH`. This story
closes that gap with a single orchestration function that is now the
one sanctioned path from "I have an authorization" to "the connector
actually ran."

## Design decisions

- **One function, not a class** — `runGatedExecution()` takes a
  connector, action, parameters, `PreconditionSet`, and
  `ExecutionAuthorization`, and returns a discriminated
  `GatedExecutionResult`. No state to hold between calls, so a class
  would only add ceremony.
- **`GatedExecutionResult` has three outcomes, not a boolean** —
  `EXECUTED` | `BLOCKED_DRIFTED` | `BLOCKED_UNKNOWN`. Collapsing DRIFTED
  and UNKNOWN into one "blocked" outcome would lose the distinction the
  spec cares about: DRIFTED means "the world provably changed under the
  plan," UNKNOWN means "we couldn't tell" — spec §14B requires UNKNOWN
  be treated as missing required context (i.e. it should escalate
  through the same path as any other missing-context case upstream),
  which callers can't do if the two are merged into one shape.
  `BLOCKED_UNKNOWN` carries the same `preflightResult` as `BLOCKED_DRIFTED`
  so nothing about the underlying precondition check is thrown away.
- **DRIFTED and UNKNOWN both block unconditionally — no override
  parameter, no "force" flag.** The acceptance criteria are explicit
  that DRIFTED blocks unconditionally and UNKNOWN is never an implicit
  pass; adding an escape hatch would silently reopen exactly the gap
  this story exists to close.
- **`execute()` is only ever reached through this function's own
  control flow** — there's no separate "skip preflight" branch. This is
  the concrete mechanism behind CONTEXT.md RULE 6 ("No agent-facing
  code path may call `ActionConnector.execute()` directly"): once an
  orchestrator adopts `runGatedExecution()` as its only call site for
  driving a connector, RULE 6 is enforced by construction rather than
  by convention.
- **Reuses D-01's `ActionConnector` interface and `PreconditionSet`/
  `PreflightResult` contracts as-is** — no new contract types needed;
  D-02 is purely an orchestration story on top of already-shipped
  primitives.

## Files

- `packages/action-executor/src/gated-execution.ts` (+ test) — the core of this story.
- `packages/action-executor/src/index.ts` — barrel export added.
- `packages/action-executor/src/simulated-action-connector.test.ts` — two coverage-gap tests added (`within_range` with a non-number observed value; `rollback()` deleting a key that execute() introduced with no prior value) — pre-existing gaps from D-01, closed while bringing the repo back to 100% coverage for this story's gate.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 56 test files, 465 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Runs immediately before every execute() call (F-10) — `runGatedExecution()` is structurally sequential: `preflight()` always runs first, and `execute()` is only reachable from inside the same call when preflight status is `MATCH`; a dedicated test asserts the call order (`["preflight", "execute"]`) is never reversed
- [x] DRIFTED blocks execution unconditionally; UNKNOWN (preflight failure) treated as missing required context, never an implicit pass — `CRITICAL`-labeled tests for both outcomes, using a connector whose `execute()` throws if ever reached, proving `execute()` is genuinely never called
- [x] A deliberately staged drift against the simulated connector's preconditions is caught and blocks execution — a dedicated test constructs a `SimulatedActionConnector` with target state that has drifted since the plan was proposed, runs it through `runGatedExecution()`, asserts `BLOCKED_DRIFTED`, and asserts the target state is provably untouched
