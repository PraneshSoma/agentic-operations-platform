# C-01: IdentityResolver interface + local dev-principal implementation

**Phase:** C — Identity & Governance (first story — Phase C begins)
**Depends on:** A-03
**Status:** DONE

## Summary

New `packages/identity` package. Implements ADR-012's `IdentityResolver`:
an interface (mirroring `SecretResolver`'s pattern per ADR-012's own
decision text) plus `LocalDevIdentityResolver`, a fixed, config-defined
set of development principals — no external call, no real SSO.

## Contract gap closed

`IdentityPrincipalSchema` — the domain-level Zod contract matching
LLD-v1 §2's `identity_principal` table shape exactly (`id`, `tenant_id`,
`display_name`, `roles`, `is_development_principal`, `created_at`). The
table itself already existed (A-03's Prisma schema); this is the
independently-validated wire/domain contract every other persisted entity
in this repo also has (Evidence vs. `evidence`, ExecutionResult vs.
`action_execution`, etc.) — a gap of the same shape A-02/B-03/B-05/B-06
each caught.

## Design decisions

- **One `resolve()` method, one backing table, for both call sites ADR-012
  names.** There is no separate "requester resolver" and "approver
  resolver" — `IncomingRequest.requester` and (the future) `ApprovalDecision.actor`
  both go through the identical `resolve(tenantId, actorId)` call against
  the identical principal map. Verified directly: a test resolves the same
  actor id framed as both a trigger requester and an approval actor and
  asserts identical results.
- **`is_development_principal: true` is not optional configuration** —
  `LocalDevIdentityResolver` sets it unconditionally on every principal it
  constructs; the constructor's own config type (`DevPrincipalConfig`)
  doesn't even have that field, so there's no way to construct a "local
  dev" principal that isn't flagged as one.
- **Risk-class approval permission is a role → risk-class map**, injected
  with a disclosed dev-only default
  (`DEFAULT_ROLE_RISK_CLASS_PERMISSIONS`), overridable via the
  constructor. Tenant-configurable real policy is C-03's job once the
  Policy Engine's tenant-rule evaluation exists; this default is enough to
  satisfy C-01's own acceptance criterion (risk-class approval permission
  resolution) without inventing C-03's contract early.
- **`RiskClass` is a local type alias, not newly centralized.** The same
  4-value union is already inlined in `ActionDefinition.default_risk_class`
  and `PolicyDecision.effective_risk_class` in `packages/contracts`;
  promoting it to one shared exported schema would mean editing two
  already-ACCEPTED contract files for a story that doesn't need to — noted
  explicitly as acknowledged duplication, not a new inconsistency.

## Files

- `packages/contracts/src/schemas/identity-principal.ts` (+ test).
- `packages/identity/src/identity-resolver.ts` — the interface (type-only, excluded from coverage like `llm-provider.ts`).
- `packages/identity/src/local-dev-identity-resolver.ts` (+ test) — the core of this story.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 42 test files, 341 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Resolves an actor reference to identity, `tenant_id`, roles, risk-class approval permission (LLD §5) — built at MVP per ADR-012's correction, not deferred
- [x] Dev principals are a static config list, clearly flagged `is_development_principal: true` — structurally guaranteed, not just configured correctly
- [x] Resolves both `IncomingRequest.requester` and `ApprovalDecision.actor` through the same table — verified directly by a dedicated test
