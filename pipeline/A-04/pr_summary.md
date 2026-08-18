# A-04: Validate OPC A/B/C (spec §35) against the OPC schema

**Phase:** A — Contracts
**Depends on:** A-02
**Status:** DONE

## Summary

Spec §35 names three worked scenarios — Data Reconciliation, Production
Error Spike, and Access/Entitlement Issue — and states the abstraction
test directly: *"If these require scenario-specific runtime branches, the
schema/runtime abstraction is incomplete."* This story builds all three as
concrete `OperationalProcedureContract` fixtures and parses each through
the unmodified `OperationalProcedureContractSchema` from A-01.

## Files

- `packages/contracts/src/schemas/operational-procedure-contract.fixtures.ts` — the three worked OPCs, one export each.
- `packages/contracts/src/schemas/opc-scenarios.test.ts` — parses all three, plus a structural check that all three share the exact same top-level key set (no scenario grew its own extra field).

## Result

All three OPCs — spanning a data-integrity flow, an incident-remediation
flow, and an access-request flow — parse cleanly through the same schema
with zero modification, zero discriminated union, zero OPC-type-specific
branch anywhere in `@aop/contracts`. There is no runtime orchestrator yet
to prove this at the execution level (that lands in Phase B) — this story
proves it at the contract level, which is what it was scoped to prove.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 16 test files, 174 tests, all passed
coverage         → 100% on all packages/contracts files (incl. the new fixtures/test)
```

## Acceptance criteria

- [x] All three OPC definitions parse cleanly through `OperationalProcedureContract`'s Zod schema
- [x] No OPC requires a runtime code branch to represent — schema/runtime abstraction proven complete at the contract level
