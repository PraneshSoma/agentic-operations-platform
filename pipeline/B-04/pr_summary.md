# B-04: Simulated context connectors (application/runtime/evidence)

**Phase:** B — Happy-path runtime
**Depends on:** A-02
**Status:** DONE

## Summary

New `packages/context-service` package. Implements spec §10's read-only
`ContextConnector` interface, one simulated fixture-backed implementation
covering all three context types, and `assembleContextPackage()` — spec
§8-9's Context Service, producing a schema-valid `ContextPackage` from
an OPC's `required_context` list.

## Contract gap closed

`ApplicationContextSchema`/`RuntimeContextSchema`/`HistoricalEvidenceContextSchema`
existed in `context-package.ts` (A-02) but were **not exported** — only
their inferred TS types were. `assembleContextPackage()` needs to validate
raw connector output against each sub-shape independently, before it has
a full `ContextPackage` to validate against. Exported all three
(additive-only — no field changed, just visibility).

## Design decisions

- **`SimulatedFixtureConnector`** — one generic class backs all three
  context types (the interface and behavior — lookup, staleness, missing
  data — are identical across application/runtime/evidence; only the
  fixture data and `ConnectorDescriptor` differ per instance), against an
  in-memory fixture map, never a real system (story's explicit scope).
  A fixture entry of the literal `"unavailable"` simulates a source with
  no data; a `retrievedAt` older than the connector's own
  `staleness.max_age_seconds` simulates stale data.
- **NFR-02 enforced structurally, not just documented**: `ContextConnector`
  has no write/mutate method at all — there's nothing on the interface
  capable of exposing one. A test additionally inspects the connector's
  own prototype methods to confirm only `descriptor`/`validateConfig`/
  `executeRead` exist.
- **`assembleContextPackage()` never throws on missing/stale/invalid
  data** — every one of those routes to `missing_context` (or
  `stale_context`), and the returned `ContextPackage` still validates
  against `ContextPackageSchema` every time, falling back to well-typed
  empty defaults for `application_context`/`runtime_context`/
  `historical_evidence` (which are non-optional per the ACCEPTED schema).
  It only propagates a genuine, unexpected connector error (anything that
  isn't `ContextUnavailableError`) — verified explicitly.
- **`RequiredContextEntry` has no per-entry lookup key** in spec's own
  shape, so `assembleContextPackage()` calls every connector with an empty
  input object; `SimulatedFixtureConnector` defaults to fixture key
  `"default"` in that case — documented in both files, not a hidden
  convention.

## Files

- `packages/contracts/src/schemas/context-package.ts` — export the three sub-schemas (gap fix).
- `packages/context-service/src/connector.ts` (+ implicit tests via connector test) — `ContextConnector`, `ConnectorReadResult`, `ConnectorExecutionContext`, `ConnectorConfig`, `ValidationResult`, `ContextUnavailableError`.
- `packages/context-service/src/fixtures/simulated-fixture-connector.ts` (+ test).
- `packages/context-service/src/assembly/assemble-context-package.ts` (+ test) — the core of this story.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 32 test files, 265 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Implements `ContextConnector` interface against fixture/fake data, not a real system — `SimulatedFixtureConnector`
- [x] `ContextPackage.missing_context` and `stale_context` populate correctly when a fixture is configured as unavailable/stale — two `CRITICAL`-labeled tests, plus the tolerance-boundary case (fresh data is NOT marked stale)
- [x] Never exposes a write operation through the connector interface (NFR-02) — structurally (no such method exists) and verified by a prototype-inspection test
