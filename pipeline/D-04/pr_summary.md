# D-04: Rollback decision gate — REVERSIBLE/COMPENSATABLE/IRREVERSIBLE

**Phase:** D — Execution (simulated)
**Depends on:** D-01, C-02
**Status:** DONE

## Summary

Two changes close this story's three acceptance criteria:

1. `packages/action-executor/src/action-registry.ts` — `InMemoryActionRegistry.register()` now runs every action through `ActionDefinitionSchema.parse()` before storing it, so ADR-001's reversible/compensation_class invariant is genuinely enforced at registration, not merely expressible in the schema.
2. `packages/action-executor/src/rollback-decision.ts` (new, + test) — `runRollbackDecision()`, the structural gate deciding whether/how a verification-recommended rollback may proceed, branching on the action's `compensation_class`.

## Design decisions

- **Enforcement point is `ActionRegistry.register()`, not
  `ActionConnector.validateAction()` — a disclosed refinement of
  ADR-001's literal text.** ADR-001's rationale names
  `ActionConnector.validateAction()` as where the reversible/
  compensation_class rule should be enforced, but that text predates the
  concrete split this codebase later settled on: C-02's Action Registry
  (the single place an action is stored and later found) versus D-01's
  ActionConnector (invoked per execution attempt, once an action has
  already been resolved out of the registry). Enforcing only in
  `validateAction()` would mean an inconsistent action could sit in the
  registry — findable via `lookup()`, indefinitely — until someone
  actually tried to run it. This story's own acceptance criterion says
  "validated at **registration**," which is `ActionRegistry.register()`
  by name; enforcing there rejects the inconsistency before the action
  is ever stored, which is strictly earlier and strictly stronger than
  ADR-001's original text achieves. No new ADR was opened for this since
  it changes an implementation detail, not the decision itself (Option
  B — additive `compensation_class` + a consistency rule — is unchanged).
- **Registration validation closes a real gap, not a hypothetical one.**
  `ActionDefinitionSchema` has carried the reversible/compensation_class
  `.refine()` since A-02, but `ActionRegistry.register()` (C-02) took an
  already-typed `ActionDefinition` and stored it verbatim — nothing
  actually ran the refine at the one place every action must pass
  through to become findable. A caller could construct an object that
  structurally satisfies the TypeScript type (the refine isn't
  compile-time checkable) while violating ADR-001, and the registry
  would accept it silently. `register()` now calls
  `ActionDefinitionSchema.parse(action)` itself and stores the
  validated result, closing that gap without changing the public
  `ActionRegistry` interface.
- **The rollback decision gate has three outcomes, not two** —
  `ROLLED_BACK` / `COMPENSATION_REQUIRED` / `NOT_ATTEMPTED`. F-14
  explicitly reworked v1's assumption that `reversible: true` uniformly
  means "rollback is available": REVERSIBLE's instant technical reversal
  and COMPENSATABLE's "propose a new, fully governed corrective action"
  are not the same shape, and F-14 is explicit that a COMPENSATABLE
  action's remedy "must never be represented as" an instant rollback.
  Collapsing them into one "rollback attempted" outcome would do exactly
  that. `COMPENSATION_REQUIRED` is returned instead — this gate never
  calls `connector.rollback()` for a COMPENSATABLE action. Driving the
  actual re-governed compensating `ProposedAction` through planning,
  policy, and approval again is out of this MVP gate's scope (F-14's own
  AC marks that flow Post-MVP); this story's job is only to make sure
  the MVP gate never takes the shortcut F-14 forbids.
- **IRREVERSIBLE is checked independently of the verification result's
  own recommendation, defense-in-depth style** — the same shape as the
  Policy Engine's HARD_DENY_CHECKS (C-03). D-03's `runVerification()`
  already guarantees `recommended_next_step` is never `ROLLBACK` for an
  IRREVERSIBLE action, so this gate's own IRREVERSIBLE check should be
  unreachable in the "recommended ROLLBACK anyway" branch — but it's
  there and throws loudly rather than trusting the verification result's
  word for it and calling `connector.rollback()` regardless. Two
  independent checks that must both agree, neither trusted alone, before
  a state-changing rollback call is allowed to happen.
- **The simulated MVP action (`restart_service`) is explicitly classed
  `REVERSIBLE`** (unchanged since D-01) and its rollback behavior now
  provably matches that class: a dedicated test drives it through
  `runRollbackDecision()` end-to-end and asserts the target state
  actually reverts — not just that `connector.rollback()` was reachable,
  but that calling through the gate produces the same real state
  reversion `SimulatedActionConnector.rollback()` always has.

## Files

- `packages/action-executor/src/action-registry.ts` — validation added to `register()`.
- `packages/action-executor/src/action-registry.test.ts` — one new `CRITICAL`-labeled test for the rejected-invariant case.
- `packages/action-executor/src/rollback-decision.ts` (+ test) — the core of this story.
- `packages/action-executor/src/index.ts` — barrel export added.
- `packages/contracts/src/schemas/action-definition.ts` — doc comment corrected to name the actual enforcement point (`ActionRegistry.register()`, not `ActionConnector.validateAction()`, which never implemented it).

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 59 test files, 484 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Three-class distinction present and validated at registration (ADR-001, F-14 MVP gate) — `CRITICAL`-labeled test: `register()` throws on an inconsistent reversible/compensation_class pair and the action is never stored
- [x] IRREVERSIBLE actions never attempt rollback — verification failure escalates directly — `CRITICAL`-labeled tests: `connector.rollback()` is never reached for an IRREVERSIBLE action even when a (defensively-checked) verification result incorrectly recommends `ROLLBACK`; the correct case (`ESCALATE`) returns `NOT_ATTEMPTED, reason: IRREVERSIBLE`
- [x] Simulated MVP action is explicitly classed and its rollback behavior matches its class — `restart_service` is `compensation_class: REVERSIBLE`; a dedicated test runs it through `runRollbackDecision()` and asserts the simulated target's state genuinely reverts
