# C-05: SecretResolver interface + local env-var implementation

**Phase:** C — Identity & Governance (queued after Phase D's dependency-graph slot, landed here to close out the phase's remaining story)
**Depends on:** A-02
**Status:** DONE

## Summary

New `packages/secrets` package. Implements ADR-009's `SecretResolver`:
an interface + `EnvVarSecretResolver`, the local development
implementation ("no external call, no real secret manager"). Retrofits
B-04's `SimulatedFixtureConnector` to actually resolve its credential
through the interface on every read — the first connector genuinely
"built against this interface," making the story's second acceptance
criterion concretely testable rather than aspirational.

## Design decisions

- **`secret_ref` convention: `secret://<ENV_VAR_NAME>`.** A simple,
  explicit convention — `EnvVarSecretResolver` rejects any ref that
  doesn't start with the prefix, rather than silently misinterpreting an
  unrelated string as an env var name.
- **Retrofitted `SimulatedFixtureConnector`, not left it secret-free.**
  Before this story it never touched authorization at all, despite
  carrying an `authorization.secret_ref` on its descriptor. ADR-009 says
  "connectors code against the interface only" — a connector that never
  calls it isn't proving anything about the interface. The retrofit adds
  exactly one line (`await this.secretResolver.resolve(...)`), used only
  to authenticate the (simulated) read, never returned, never logged —
  CONTEXT.md RULE 5's exact pattern. This is a real constructor-signature
  change to an existing B-04 class; all 10 existing call sites across two
  test files were updated to pass a resolver, none of their behavior
  changed.
- **`test_executeRead_neverExposesSecretValue()`** implemented as a
  literally-named function per the story's own acceptance criterion —
  asserts the secret value appears nowhere in the serialized result,
  `data`, or `query_ref`.
- Two additional tests prove the interface is actually load-bearing, not
  decorative: one spies on `resolve()` to confirm the exact `secret_ref`
  from the descriptor is what gets resolved; another confirms a
  `SecretResolver` failure propagates and the read does not proceed with
  stale/default behavior.

## Files

- `packages/secrets/src/secret-resolver.ts` — the interface + `SecretNotFoundError`.
- `packages/secrets/src/env-var-secret-resolver.ts` (+ test) — the local implementation.
- `packages/context-service/src/fixtures/simulated-fixture-connector.ts` (+ test) — the retrofit, this story's real proof point.
- `packages/context-service/src/assembly/assemble-context-package.test.ts` — updated call sites (behavior unchanged).

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 53 test files, 441 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Connectors resolve secrets only via `SecretResolver`, never a concrete SDK directly (ADR-009) — `SimulatedFixtureConnector` now genuinely does this, verified by a spy proving the exact `secret_ref` resolved
- [x] `test_executeRead_neverExposesSecretValue()` passes for every connector built against this interface — implemented and passing for the one connector that exists so far; the pattern (and the test name) carries forward to every connector D-01 onward builds
