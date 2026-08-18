# C-02: Versioned Action Registry (registry mechanics only)

**Phase:** C — Identity & Governance
**Depends on:** A-02
**Status:** DONE

## Summary

`packages/action-executor/src/action-registry.ts`: spec §13's registry
mechanics, scoped exactly as the story title says — "registry mechanics
only." The full `ActionConnector` interface and connector invocation land
in D-01; this story is `register()`/`lookup()` and nothing else.

## Design decisions

- **Lookup key is always the full `(tenant_id, action_ref, version)`
  triple** (F-07) — there is no lookup-by-`action_ref`-alone method on the
  interface at all, so a caller cannot accidentally take an unversioned
  shortcut.
- **RULE 8 ("no runtime branch on action kind") is verified by absence,
  not by a positive assertion a test can fake.** `action-registry.ts`
  contains zero conditionals keyed on `executor_connector_ref` or any
  other kind-indicating field — the file's own doc comment states this
  explicitly. The `CRITICAL`-labeled test registers one operational
  action (`executor_connector_ref: "k8s-connector"`) and one
  engineering-change action (`executor_connector_ref:
  "engineering-change-executor"`, per CONTEXT.md's description of that
  action kind) through the *identical* `register()`/`lookup()` calls and
  confirms both resolve correctly — proving the registry treats
  "governed identically" as data, not as a code branch.
- **`lookupActive()` is a separate method from `lookup()`**, not a filter
  parameter — `status: disabled` is common enough (an action pulled from
  rotation without deleting its history) that execution-time resolution
  needing "only active" deserves its own clear name, while raw `lookup()`
  stays available for anything that legitimately needs to see a disabled
  action (e.g. an audit view).
- **Registration overwrites**, it isn't append-only — re-registering the
  same key (e.g. flipping `status` from `active` to `disabled`) replaces
  the prior row, matching how a real `action_definition` table row update
  would behave.

## Files

- `packages/action-executor/src/action-registry.ts` (+ test).

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 43 test files, 350 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] `ActionDefinition` versioned, `status` active|disabled, lookup always by `tenant_id` + `action_ref` + `version` (F-07) — no lookup-by-`action_ref`-alone method exists on the interface
- [x] Every `ActionDefinition` validates/executes through the identical `ActionConnector` interface regardless of kind — no runtime branch on action kind (RULE 8) — verified structurally (zero kind-conditional code in the file) and behaviorally (the `CRITICAL` test)
