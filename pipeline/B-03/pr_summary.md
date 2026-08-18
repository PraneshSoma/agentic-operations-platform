# B-03: Durable orchestrator state machine skeleton, including EXECUTION_UNCERTAIN

**Phase:** B — Happy-path runtime
**Depends on:** B-02
**Status:** DONE

## Summary

New `apps/worker` package (CONTEXT.md's stated home for the durable
orchestrator). Implements the `ExecutionStateMachine`: the full
`ExecutionState` graph (spec §7's flat enum, combined with LLD-v1 §4's
`EXECUTION_UNCERTAIN` sub-graph), enforcing RULE 7's persist → emit →
evidence contract on every transition, and spec §31's idempotent
trigger-redelivery requirement. This is the *skeleton* — it enforces which
transitions are legal and their side-effect contract; the business logic
that decides *when* to make a given transition (running an investigation,
evaluating policy, executing an action) is later stories' job (B-04
through D-07).

## Contract gap closed

`PlatformEvent` (spec §22) is required by every transition (RULE 7's
"emit an event") but had no schema in `@aop/contracts` — same kind of gap
A-02 caught for `VerificationResult`. Added `PlatformEventSchema` +
`RECOMMENDED_EVENT_TYPES` (spec §22's list, exported as a plain reference
array, not a schema constraint — the YAML itself types `event_type` as an
unconstrained string, and new lifecycle points are expected to add new
event types over time per CONTEXT.md RULE 8).

## Design decisions

- **Three pluggable dependencies** (`ExecutionStateStore`,
  `PlatformEventEmitter`, `EvidenceRecorder`), each with an in-memory
  implementation — same interface/impl-swap pattern as every I/O boundary
  this session (`RawPayloadStore` B-01, `OpcMatchEvidenceSink` B-02,
  ADR-009/012 before that). Real backing stores land in E-01/E-02 without
  touching the state machine.
- **RULE 7 ordering is structural, not just tested**: `applyTransition()`
  is the single private method every public entry point funnels through,
  and it calls `stateStore.save()` → `eventEmitter.emit()` →
  `evidenceRecorder.record()` in that fixed order, every time — there is
  no code path that can call these out of order or skip one.
- **`EXECUTION_UNCERTAIN`'s three exits are proof-gated at the type
  level**, not just by convention: `transitionTo()` requires an
  `UncertainExitProof` parameter whenever the execution is currently
  `EXECUTION_UNCERTAIN`, and a lookup table
  (`UNCERTAIN_EXIT_TARGET`) rejects any proof/target-state combination
  that doesn't exactly match LLD-v1 §4's diagram. There is no fourth,
  undiagrammed exit, and no way to leave `EXECUTION_UNCERTAIN` with no
  proof at all — this is ADR-004's "no default/timeout fallback"
  enforced structurally.
- **Idempotency key at this entry point is (tenant_id, request_id)**
  (spec §31's full key — `+ plan_id + step_id + action_version` — applies
  to later idempotency keys: approval callbacks, action execution; not to
  execution *creation*, which is what `createExecution()` handles). A
  re-delivered trigger with the same key returns the existing execution
  unchanged and makes **zero** calls to persist/emit/evidence — verified
  explicitly by resetting the call-order tracker before the second call
  and asserting it stays empty.

## Files

- `packages/contracts/src/schemas/platform-event.ts` (+ test) — the contract gap fix.
- `apps/worker/src/orchestrator/state-machine.ts` (+ test) — `ExecutionStateMachine`, the transition graph, `UncertainExitProof`.
- `apps/worker/src/orchestrator/execution-state-store.ts`, `platform-event-emitter.ts`, `evidence-recorder.ts` (+ tests) — the three pluggable dependencies.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 29 test files, 247 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Every transition persists state + emits `PlatformEvent` + writes `Evidence`, all three, same order, every time (RULE 7) — structurally enforced by `applyTransition()`, explicitly asserted by a 27-call order test walking the full happy path
- [x] State machine implements the full stateDiagram in LLD §4, including all three proof-gated exits from `EXECUTION_UNCERTAIN` — each exit has a dedicated `CRITICAL`-labeled test, plus tests for the no-proof and mismatched-proof rejection paths and the fourth-exit rejection
- [x] Re-delivering the same trigger is a no-op (idempotency key per spec §31) — verified: zero persist/emit/evidence calls on the second `createExecution()` with the same `(tenant_id, request_id)`
