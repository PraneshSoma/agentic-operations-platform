# D-01: Simulated ActionConnector

**Phase:** D — Execution (simulated) (first story — Phase D begins)
**Depends on:** C-02, C-04
**Status:** DONE

## Summary

`packages/action-executor/src/{action-connector,simulated-action-connector}.ts`:
spec §14's write-side `ActionConnector` interface, and
`SimulatedActionConnector` — a real (not stubbed) implementation against
an in-memory "sandboxed target" that genuinely mutates on `execute()`,
genuinely reads on `preflight()`, and genuinely reverts on `rollback()`.
Also: `apps/worker/src/governed-pipeline-end-to-end.test.ts` — one test
chaining every governed stage built across this session (B-01 through
D-01) against a single coherent scenario.

## Design decisions

- **`descriptor()` reuses the existing `ConnectorDescriptor` contract**,
  not a new `ActionConnectorDescriptor`. Spec §14 names a distinct type
  but never defines its shape separately from §10's descriptor — every
  field that matters for a write connector (`connector_id`, `tenant_id`,
  `authorization`, `scopes`, `staleness`) means the same thing either
  way, so inventing a parallel contract with no spec-given fields to
  differ by would be speculative.
- **`preflight()` is a real, working precondition check**, not a stub
  that always returns `MATCH` — deferring the full drift-detection
  *refinement* to D-02 doesn't mean D-01 gets to fake it. The connector
  holds real in-memory target state; a staged drift genuinely produces
  `DRIFTED` with the actual observed/expected values, and a field the
  connector can't observe at all genuinely produces `UNKNOWN` (never an
  implicit pass, per spec §14B).
- **`rollback()` genuinely reverts state**, from a snapshot captured at
  `execute()` time (keyed by `execution_result_id`) — not a call that
  just returns `SUCCESS` without doing anything.
- **`deepEqual` extracted to a shared `deep-equal.ts`** in
  `packages/action-executor` — previously private to
  `frozen-plan-guard.ts` (B-06); the simulated connector's `exact`/
  `unchanged_since` tolerance checks needed the same structural
  comparison, so it moved to a shared module rather than being
  duplicated. No behavior change to `frozen-plan-guard.ts`.
- **`unchanged_since` tolerance is simplified**: checked as "still equals
  the last known value," same as `exact`. A real implementation against
  a real target would additionally need a last-modified timestamp; that
  level of fidelity isn't needed to prove the governed pipeline
  end-to-end, which is this story's actual scope — disclosed explicitly
  in the code comment, not silently approximated.
- **The end-to-end test lives in `apps/worker`**, not
  `packages/action-executor` — it's the one component that naturally
  depends on every other package involved (contracts, policy-engine,
  identity, secrets, context-service, action-executor), matching the real
  system's own architecture where the orchestrator coordinates all of
  them. It chains: `IncomingRequest` → OPC match (B-02) → context
  assembly (B-04) → investigation (B-05) → planning (B-06) → policy
  evaluation, `REQUIRE_APPROVAL` (C-03) → Approval Acceptance Gate,
  `ExecutionAuthorization` (C-04) → Frozen Plan Rule check (B-06) →
  preflight → execute (D-01) — using only simulated/in-memory
  implementations throughout, and asserts the only thing that changed
  anywhere is the connector's own `Map`.

## Files

- `packages/action-executor/src/action-connector.ts` — the interface + `MissingAuthorizationError`/`ExpiredAuthorizationError`.
- `packages/action-executor/src/simulated-action-connector.ts` (+ test) — the core of this story.
- `packages/action-executor/src/deep-equal.ts` — extracted shared helper.
- `packages/action-executor/src/frozen-plan-guard.ts` — updated to import the shared helper (no behavior change).
- `apps/worker/src/governed-pipeline-end-to-end.test.ts` — the capstone integration test.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 55 test files, 458 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Implements the full `ActionConnector` interface (`validateAction`/`preflight`/`execute`/`rollback`) against a fake/sandboxed target (F-18 MVP) — all four methods genuinely functional against real in-memory state, not stubs
- [x] Proves the complete governed pipeline end-to-end without a real production mutation — one integration test chains ten stages from trigger through executed action, asserting only the simulated connector's own `Map` ever changes
- [x] `execute()` rejects when called without a resolved `ExecutionAuthorization` — `CRITICAL`-labeled test, `MissingAuthorizationError` thrown; the same guard also covers `rollback()`
