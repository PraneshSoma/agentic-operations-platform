# E-07: Tenant activation gate

**Phase:** E — Evidence, confidence, dashboard (final MVP story)
**Depends on:** C-01, E-01
**Status:** DONE

## Summary

The unified tenant activation gate (LLD-v1 §6) — a REAL technical gate,
not documentation. `POST /tenants/{tenantId}/onboarding/activate` stamps
`production_activated_at` only when both ADR-011's retention requirement
and ADR-012's dev-principal requirement are satisfied; otherwise it
returns 409 with concrete rejection reasons and stamps nothing.

## Design decisions

- **The gate is fail-closed and enforced in code, never documented-only.**
  `evaluateActivation()` returns `READY` only when
  `retention_policy_confirmed_at` is set AND the tenant's roster contains
  no `is_development_principal` — otherwise `REJECTED` with the specific
  reason codes. There is no "activate anyway" path. The route stamps
  `production_activated_at` exclusively on the `READY` branch; on rejection
  it writes nothing, proven by a route test that asserts the fake
  repository's activation write never fired.
- **It genuinely unifies ADR-011 and ADR-012** in one decision, per
  LLD-v1 §6:
  - ADR-011: `RETENTION_POLICY_NOT_CONFIRMED` blocks activation until a
    real per-class retention decision is recorded — the counterpart to
    E-01's `dev-nonprod-v0` retention marker (the dev default "expires
    with the prototype, not silently becomes the policy by inertia").
  - ADR-012: `DEVELOPMENT_PRINCIPAL_IN_PATH` blocks activation while any
    `is_development_principal` is in the tenant's roster, listing the
    offending ids — "a real pilot doesn't accidentally run on placeholder
    identities."
  - Both failures are reported together (a `CRITICAL` test), so an
    operator sees everything blocking activation at once.
- **Pure gate / Prisma edge split, consistent with all of Phase E.**
  `evaluateActivation()` is pure and unit-tested at 100% in the default
  gate. `PrismaTenantActivationRepository` (the tenant/principal reads and
  the one sanctioned write — the activation stamp) is DB-bound, excluded
  from the default coverage gate, and verified by a `.integration.test.ts`
  — **4 integration tests executed and passing against live PostgreSQL
  16**, including a `CRITICAL` test proving the activation write is real
  and durable, and that a real `is_development_principal` row blocks
  activation.
- **Idempotent.** An already-activated tenant returns 200
  `ALREADY_ACTIVATED` with its existing stamp rather than re-stamping —
  activation is a one-way, one-time transition.
- **The onboarding route registers only when a repository is provided**
  (same seam as E-05/E-06), so the DB-free route suites are unaffected.

## Files

- `packages/evidence-ledger/src/activation/tenant-activation.ts` (+ test) — the pure `evaluateActivation` gate.
- `packages/evidence-ledger/src/activation/prisma-tenant-activation-repository.ts` (+ integration test) — reads + the activation write.
- `packages/evidence-ledger/src/index.ts` — barrel exports; `vitest.config.ts` — Prisma repo excluded from default coverage.
- `apps/api/src/routes/onboarding.ts` (+ test) — the activation route.
- `apps/api/src/app.ts` — `tenantActivationRepository` option, conditional registration.

## Gate results

```
pnpm typecheck                 → clean, exit 0
pnpm lint                      → clean, exit 0 (zero warnings)
pnpm test (default gate)       → 83 test files, 706 tests, all passed
coverage (default gate)        → 100% statements/branches/functions/lines, every file in the repo
integration (real Postgres)    → 4 activation tests passing; full Phase-E DB suite green together
                                 (36 integration tests across evidence/outbox/read/activation) on live PostgreSQL 16
```

## Acceptance criteria

- [x] `POST /tenants/{tenantId}/onboarding/activate` rejects unless `retention_policy_confirmed_at` is set AND no production-flagged execution path resolves through an `is_development_principal` identity (LLD §6, unifying ADR-011 + ADR-012) — `evaluateActivation()` enforces both conditions; `CRITICAL` unit, route, and real-Postgres integration tests cover each rejection and the combined case
- [x] Activation is a real technical gate, not documentation-only — the route stamps `production_activated_at` only on the `READY` branch and writes nothing on rejection (asserted at the route level); the integration test proves the activation write is real and durable in Postgres
