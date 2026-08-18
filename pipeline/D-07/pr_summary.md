# D-07: Crash-recovery marker + status-check, end-to-end

**Phase:** D — Execution (simulated) (last story in Phase D)
**Depends on:** D-01, B-03, A-03
**Status:** DONE

## Summary

Implements ADR-004's full crash-recovery decision tree end-to-end, per
LLD-v1 §2/§7.2: a new `ExecutionStepMarker` contract + store, a
deterministic `operation_id` derivation, a widened `ActionConnector`
interface (`execute()` now threads `operationId`; a new mandatory
`statusCheck()` method), the internal `POST /internal/connectors/
{connector_ref}/status-check` endpoint, and three orchestration
functions in `apps/worker` (`beginTrackedExecution`,
`completeTrackedExecution`, `recoverUncertainExecution`) implementing
LLD-v1 §7.2's sequence diagram exactly.

## Design decisions

- **`ActionConnector.execute()` gains a required `operationId` param;
  `statusCheck()` is a new required method — a disclosed retrofit of
  D-01's already-shipped interface.** LLD-v1 §7.2's sequence diagram
  itself shows `execute(action, params, operation_id)` — the connector
  needs the same stable id threaded through at call time so a later
  `statusCheck()` call, after a crash, can genuinely correlate "did THIS
  operation happen," the way a real idempotency key works against a real
  production system. This is squarely this story's own scope (crash
  recovery didn't exist before D-07), not a violation of an already-
  ACCEPTED design — same disclosed-retrofit precedent as C-05's
  `SimulatedFixtureConnector` constructor change. All existing call
  sites across `simulated-action-connector.test.ts`,
  `gated-execution.ts`/`.test.ts`, `rollback-decision.test.ts`, and
  `governed-pipeline-end-to-end.test.ts` updated; behavior unchanged
  everywhere except the new capability itself.
- **`UncertainExitProof` (B-03) gains a fourth kind:
  `inconclusive_idempotent_retry`.** B-03's original three proof kinds
  covered "proven not executed," "proven executed," and "inconclusive +
  not idempotent" (escalate) — but LLD-v1 §7.2's full sequence has a
  fourth branch B-03 didn't yet need: "inconclusive + provably
  idempotent" is ALSO safe to retry, for a different reason than
  `operation_did_not_occur` (retrying is harmless even if the operation
  already happened, not "we know it didn't"). Reusing the wrong-shaped
  proof kind would misrepresent what was actually proven — a fourth,
  honestly-named kind is the fix, matching ADR-004's own "no default/
  timeout fallback, every exit carries an honest proof" discipline.
- **`ALLOWED_TRANSITIONS` is unchanged beyond D-05/D-06's prior
  extensions** — `EXECUTION_UNCERTAIN`'s own transitions
  (`EXECUTING`/`VERIFYING`/`ESCALATED_HUMAN_OVERRIDE`) already covered
  every target this story's recovery function needs; only the *proof*
  vocabulary needed extending, not the state graph itself.
- **Three orchestration functions, not one monolith** — matching LLD-v1
  §7.2's own two annotated transaction boundaries plus the recovery
  branch: `beginTrackedExecution()` (marker + pre-execute state write,
  before any connector call), `completeTrackedExecution()` (marker
  COMPLETED + VERIFYING, normal path), `recoverUncertainExecution()`
  (the full crash-recovery decision tree). Each is independently
  testable and composable with D-02's `runGatedExecution()`, which the
  caller invokes between `beginTrackedExecution()` and
  `completeTrackedExecution()` — this story doesn't wrap or duplicate
  that gate, it brackets it.
- **"Same transaction" is approximated the same way state-machine.ts
  already approximates RULE 7** — no real DB transaction exists yet
  (E-01 wires the real backing store); the marker write and its paired
  state transition are sequenced directly one after another, with
  nothing else able to run between them, disclosed explicitly in the
  code comment rather than silently claimed as atomic.
- **The status-check HTTP route is a thin, disclosed-as-such shim.**
  LLD-v1 §6 names `POST /internal/connectors/{connector_ref}/status-check`
  explicitly as an HTTP contract, so it's implemented as a real Fastify
  route — but every `ActionConnector` in this codebase is an in-process
  TypeScript object, not a separate networked service, so the route
  exists to satisfy the named contract, not because the orchestrator
  itself needs HTTP to reach a connector it already holds a reference
  to. It delegates straight to the resolved connector's own
  `statusCheck()`.
- **`SimulatedActionConnector.statusCheck()` answers from real
  bookkeeping, not a stub** — `execute()` records `operationId ->
  ExecutionResult` in a map on success; `statusCheck()` looks it up.
  `connector_version` mismatch and a new `stageInconclusiveStatusCheck()`
  test helper (matching D-01's `getTargetState()`/D-02's staged-drift
  precedent) let every one of ADR-004's three outcomes be genuinely
  exercised, not asserted against a connector that always says the same
  thing.

## Files

- `packages/contracts/src/schemas/execution-step-marker.ts` (+ test) — `ExecutionStepMarkerSchema` (LLD-v1 §2).
- `packages/contracts/src/schemas/status-check.ts` (+ test) — `StatusCheckRequestSchema`/`StatusCheckResultSchema` (LLD-v1 §6).
- `packages/action-executor/src/operation-id.ts` (+ test) — `deriveOperationId()`.
- `packages/action-executor/src/execution-step-marker-store.ts` (+ test) — `ExecutionStepMarkerStore` interface + in-memory implementation.
- `packages/action-executor/src/action-connector.ts` — interface widened (`execute()` gains `operationId`; new `statusCheck()`).
- `packages/action-executor/src/simulated-action-connector.ts` (+ test additions) — `statusCheck()` implementation + `stageInconclusiveStatusCheck()` test helper.
- `packages/action-executor/src/gated-execution.ts` (+ test updates) — `operationId` threaded through.
- `packages/action-executor/src/rollback-decision.test.ts` — fake connectors updated for the widened interface.
- `apps/worker/src/orchestrator/state-machine.ts` — `UncertainExitProof` gains `inconclusive_idempotent_retry`.
- `apps/worker/src/orchestrator/crash-recovery.ts` (+ test) — the core of this story.
- `apps/worker/src/governed-pipeline-end-to-end.test.ts` — updated for the widened `execute()` signature.
- `apps/api/src/routes/status-check.ts` (+ test) — the HTTP route.
- `apps/api/src/app.ts` — `connectorRegistry` option wired in.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 68 test files, 582 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] `execution_step_marker` written in the same transaction as the pre-execute state write, before the connector call (LLD §2) — `CRITICAL`-labeled test in `beginTrackedExecution()`'s suite asserts the marker exists and the execution has transitioned to `EXECUTING` — both, before any connector method is ever called
- [x] `operation_id` is stable and reused across retries — never regenerated per attempt — `deriveOperationId()`'s own `CRITICAL` byte-identical test, plus an integration-level assertion that a `RETRY` outcome's `operationId` matches the marker's original one exactly
- [x] `POST /internal/connectors/{connector_ref}/status-check` implemented; a simulated crash mid-flight is recovered through `EXECUTION_UNCERTAIN` per LLD §7.2's sequence exactly — the HTTP route (+ tests) and a `CRITICAL`-labeled end-to-end test using a genuine `SimulatedActionConnector`: begin -> execute (real mutation) -> simulated crash (no completion call) -> `recoverUncertainExecution()` -> `EXECUTION_UNCERTAIN` -> status-check -> `CONFIRMED_EXECUTED` -> `VERIFYING`
- [x] Automatic retry is prohibited when status is inconclusive and the action is not provably idempotent (ADR-004 fail-closed rule) — `CRITICAL`-labeled test: `INCONCLUSIVE` + `is_idempotent: false` transitions to `ESCALATED_HUMAN_OVERRIDE` with the marker's `attempt_number` left untouched (no retry attempted); the idempotent counterpart is tested separately to prove the two paths are genuinely distinguished, not conflated
