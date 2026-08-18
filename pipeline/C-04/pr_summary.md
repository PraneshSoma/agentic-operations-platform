# C-04: Approval Acceptance Gate (corrected separation-of-duties flow)

**Phase:** C — Identity & Governance (last story — Phase C complete)
**Depends on:** C-01, C-03
**Status:** DONE

## Summary

`packages/policy-engine/src/approval-acceptance-gate.ts` +
`apps/api/src/routes/approvals.ts`: LLD-v1 §5's corrected sequence — the
separation-of-duties check that Revision 1 mistakenly placed inside
Policy Engine Phase 2 (before any approver identity exists) now runs
here, against the actual resolved approver, after the `PolicyDecision`
already exists.

## Contract gap closed

`ApprovalRequestSchema` / `ApprovalDecisionSchema` (spec §18) — LLD-v1
§6 references "the existing §18 approval shape... referenced, not
restated," presupposing these contracts exist; they didn't. Same pattern
as every prior gap this session.

## Design decisions

- **The gate resolves identity, not the caller.** `runApprovalAcceptanceGate()`
  takes a raw `actorId` (not a pre-built `ApprovalDecision.actor` with a
  `role` already filled in) and resolves it itself via `IdentityResolver`
  — the approver's role is only knowable after resolution, so asking a
  caller to supply it upfront would just be asking them to have already
  done the gate's job.
- **Checks run in a fixed order, each a hard precondition** (LLD-v1 §5:
  "not a warning"): `PolicyDecision.outcome === REQUIRE_APPROVAL` →
  submitted decision is `APPROVED` → actor resolves to a real identity →
  resolved identity's roles permit the risk class → (only when
  `requires_proposer_approver_separation` is true) resolved approver ≠
  accountable principal. Any failure short-circuits to `REJECTED`; the
  `ExecutionAuthorization` object is only ever constructed on the path
  where every check has already passed — there's no code path that builds
  one speculatively and discards it.
- **Issued authorizations use `mode: ON_BEHALF_OF`.** This gate only ever
  fires on the human-approval path (`REQUIRE_APPROVAL` + a real
  `ApprovalDecision`) — spec §14A's `SERVICE_ACCOUNT` mode belongs to the
  separate auto-`ALLOW` path this gate never sees. `approver_ref`/
  `requester_ref` are set from the resolved approver and the proposal's
  `accountable_principal_id` respectively.
- **`ApprovalContextStore` interface + `InMemoryApprovalContextStore`** —
  same pluggable pattern as every I/O boundary this session; real backing
  store is the Evidence Ledger, wired up in E-01.
- **`:tenantId`/`:approvalId` aren't re-validated with Zod** in the
  route, same reasoning as B-01's webhook route: Fastify's router already
  requires a non-empty path segment to match, so a param-shape check
  would be unreachable dead code.

## Files

- `packages/contracts/src/schemas/approval.ts` (+ test) — the contract gap fix.
- `packages/policy-engine/src/approval-acceptance-gate.ts` (+ test) — the core gate logic.
- `apps/api/src/approvals/approval-context-store.ts` (+ test).
- `apps/api/src/routes/approvals.ts` (+ test) — the `POST .../decision` endpoint.
- `apps/api/src/app.ts` — wired the new route in.

## Verification (real, not self-reported)

Booted the actual server and confirmed the new route alongside the
existing webhook route:

```
$ curl -s -X POST http://localhost:3000/tenants/tenant_1/approvals/appr_unknown/decision \
    -H "Content-Type: application/json" -d '{"decision":"APPROVED","actor_ref":"user_1"}'
{"error":"no approval found for approval_id \"appr_unknown\""}
HTTP 404
```

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 51 test files, 433 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Resolves the candidate approver's identity via `IdentityResolver` AFTER `PolicyDecision` exists, per LLD §5's corrected sequence — separation-of-duties is NOT checked inside Policy Engine Phase 2 — verified structurally (C-03's `evaluatePolicy()` has no separation logic at all) and behaviorally
- [x] When `requires_proposer_approver_separation` is true, `approver_principal_id == accountable_principal_id` is rejected, routed to a different approver — two `CRITICAL`-labeled tests (violation rejected, non-violation authorized), plus a test proving the check is skipped entirely when the flag is false
- [x] No `ExecutionAuthorization` issued until every check (identity resolved, role permits risk class, separation satisfied) passes — verified by asserting `"authorization" in result` is `false` across five distinct rejection paths
- [x] `POST /tenants/{tenantId}/approvals/{approvalId}/decision` implemented per LLD §6 — verified by both `.inject()` tests and a live curl smoke test against the real server
