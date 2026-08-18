# D-05: Emergency halt / kill switch

**Phase:** D — Execution (simulated)
**Depends on:** B-03, C-01
**Status:** DONE

## Summary

New contract `packages/contracts/src/schemas/halt-request.ts`
(`HaltRequestSchema`, spec §7A) and `apps/worker/src/orchestrator/
emergency-halt.ts`: `haltExecution()` — the kill switch. Halting an
in-flight execution transitions it to `ESCALATED_HUMAN_OVERRIDE` through
the existing `ExecutionStateMachine`, so it inherits RULE 7's persist ->
emit -> evidence contract for free. `ALLOWED_TRANSITIONS` in B-03's
state machine gains `ESCALATED_HUMAN_OVERRIDE` as a reachable target
from every non-terminal state, since a halt has to be able to interrupt
work at any point, not just from `EXECUTION_UNCERTAIN`.

## Design decisions

- **Halting is built on the existing state machine, not a parallel
  mechanism.** `haltExecution()` calls `stateMachine.transitionTo()`
  exactly like every other transition in this codebase — same
  persist/emit/evidence sequence, same idempotency contract, same
  `ExecutionState` row. The only new machinery is the authorization
  check and the terminal-state guard; state transition mechanics are
  reused wholesale.
- **`ALLOWED_TRANSITIONS` now allows `ESCALATED_HUMAN_OVERRIDE` from
  every non-terminal state**, not just `EXECUTION_UNCERTAIN`. B-03's
  original graph only reached that state from the uncertain-exit
  sub-graph (LLD-v1 §4); spec §7A is explicit a halt is "a way to stop
  something already executing or awaiting a step," which can arrive at
  any point before an execution's own terminal state. ADR-004's "no
  default/timeout exit from EXECUTION_UNCERTAIN" is unaffected — a halt
  is neither a default nor a timeout, it's an explicit, authorized,
  auditable human action with its own acceptance criteria.
- **The self-asserted `actor.role` in `HaltRequest` is audit context
  only, never the authorization check.** Same discipline the Approval
  Acceptance Gate already established (C-04): `haltExecution()` resolves
  the actor's real `IdentityPrincipal` via `IdentityResolver` from
  `actor.id` and checks *those* roles against `required_halt_roles` — a
  caller claiming `senior_oncall` in the request body when their real
  roles don't include it is rejected, a dedicated `CRITICAL` test proves
  it.
- **"Halt never attempts automatic rollback" is structural, not merely
  guarded.** `haltExecution()`'s signature has no dependency on
  `ActionConnector` or `runRollbackDecision()` anywhere — it cannot call
  rollback because it has no path to reach it, not because a check
  happens to prevent it. Whatever state the underlying action is in, a
  halt only ever transitions `ExecutionState` and surfaces the situation
  for a human, exactly as spec §7A item 3 requires.
- **Halting an already-halted execution is an idempotent no-op**
  (`ALREADY_HALTED`), not an error — spec §7's "every transition must be
  idempotent" applies to halt requests the same as any other, and a
  second halt call for the same execution is exactly the kind of
  re-delivery that requirement anticipates.
- **Halting an execution already in a genuinely terminal state
  (`RESOLVED`/`ESCALATED`/`FAILED`) throws, loudly** — halting doesn't
  apply to work that's already finished; a silent no-op there would hide
  a caller's mistaken belief that something was still in-flight.
- **Two things are explicitly out of scope, disclosed in the code
  itself rather than silently skipped:**
  - Spec §7A item 2 (attempt connector cancellation if supported) —
    no `ActionConnector` in this codebase defines a `cancel()`
    capability (D-01 never added one), and none of this story's three
    acceptance criteria call for adding it now.
  - `scope: "all_tenant_executions"` (halt-all) — it needs a "list all
    in-flight executions for a tenant" capability `ExecutionStateStore`
    doesn't have yet. `haltExecution()` rejects that scope value with a
    clear thrown error rather than quietly treating it as a single-
    execution halt.
- **`execution.halted` added to `RECOMMENDED_EVENT_TYPES`** (additive,
  CONTEXT.md RULE 8) — spec §22's original list predates §7A.

## Files

- `packages/contracts/src/schemas/halt-request.ts` (+ test) — `HaltRequestSchema` (spec §7A).
- `packages/contracts/src/schemas/platform-event.ts` — `execution.halted` added to the reference vocabulary.
- `apps/worker/src/orchestrator/state-machine.ts` — `ALLOWED_TRANSITIONS` extended.
- `apps/worker/src/orchestrator/emergency-halt.ts` (+ test) — the core of this story.
- `apps/worker/src/index.ts` — barrel export added.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 61 test files, 506 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Halting an in-flight execution transitions to `ESCALATED_HUMAN_OVERRIDE` with an auditable Evidence record and `execution.halted` event (F-11, spec §7A) — `CRITICAL`-labeled test asserts the persisted state, a matching `PlatformEvent`, and an `Evidence` record (`type: OUTCOME`) carrying the full `HaltRequest` in `structured_data`
- [x] Halt never attempts automatic rollback on an already-completed action — structural: `haltExecution()` has no dependency on `ActionConnector`/`runRollbackDecision()` at all, in its signature or body
- [x] `required_halt_roles` enforced via IdentityResolver — `CRITICAL`-labeled test: an actor whose real roles (resolved via `IdentityResolver`, not the request's self-claimed `actor.role`) don't include any `required_halt_role` is rejected
