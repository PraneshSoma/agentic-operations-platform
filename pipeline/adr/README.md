# ADR Decision Queue — Phase 2

Seeded from `pipeline/requirements.md`'s Open Item Register (Requirements
Revision 2, approved). Of 22 total open items, **12 are ADR-blocking** — all
12 resolved below as real ADRs. The remaining 10 are explicitly **not**
touched here:

- **OI-REQ-02, OI-REQ-10** — LLD-blocking, not ADR-blocking. Left for the LLD
  stage, which hasn't run yet.
- **OI-CTX-01, 02, 03, 04, 05, 06, 07** — Story-Gen/tenant-onboarding-blocking.
  No ADR can resolve "who is Tenant #1" or "what's their real ticketing
  system" — these need real answers from outside this repo, not architecture
  reasoning. Untouched.
- **OI-CTX-11** — explicitly Post-MVP (multi-region), not blocking anything
  in the current queue.

## Queue — Revision 2 (post-review) — ACCEPTED

The batch was reviewed and returned with a mixed verdict: 4 approved
unchanged, 5 approved with conditions (conditions incorporated into the
decision text, not left as separate follow-ups), 3 sent back for
substantive rework. All 12 revised accordingly and **APPROVED at the HIL
gate on 2026-08-17** — every ADR below is now `ACCEPTED` and, per
`loop/agents/adr.md`'s rule, immutable from this point: a future change
supersedes with a new ADR, it does not edit an accepted one in place.

**Mechanical gates, verified before advancing to LLD:**
1. ✅ All 12 ADR statuses are `ACCEPTED` (verified by direct inspection of every file's Status line).
2. ✅ Every resolved OI links back to exactly one authoritative ADR — the Resolves column below is a bijection: 12 unique OI items, 12 unique ADRs, no OI claimed by two ADRs, no ADR resolving two OIs.
3–6. Carried into `pipeline/lld/LLD-v1.md` as explicit constraints/design elements — see that document's "ADR consequences carried into LLD constraints" and "Gates 4–6" sections.

| ADR | Title | Resolves | Review verdict | Status |
|---|---|---|---|---|
| [ADR-001](./ADR-001.md) | Compensation-Class Model for Rollback | OI-REQ-05 | Approved unchanged | ACCEPTED |
| [ADR-002](./ADR-002.md) | Engineering-Change Action Invocation Mechanism | OI-REQ-03 | Approved with conditions — added `EngineeringChangeExecutor` (budget/scope/deviation controls, draft-PR-only) | ACCEPTED |
| [ADR-003](./ADR-003.md) | Risk Classification for Engineering-Change Actions | OI-REQ-04 | Approved with conditions — declarative-only scoring, no tenant code execution, 5-component blast radius | ACCEPTED |
| [ADR-004](./ADR-004.md) | Orchestrator Crash Recovery & Idempotency Mechanism | OI-REQ-06 | Approved with conditions — `operation_id` correlation, retry prohibited absent proof of idempotency | ACCEPTED |
| [ADR-005](./ADR-005.md) | Evidence Ledger Write-Durability Mechanism | OI-REQ-07 | Approved unchanged (confirmed: outbox row in same transaction) | ACCEPTED |
| [ADR-006](./ADR-006.md) | Role-Separated Review as a Verification Input | OI-REQ-01 | Approved with clarification — renamed from "independent review," context-isolated from generator's reasoning | ACCEPTED |
| [ADR-007](./ADR-007.md) | Confidence Dimension — Source Reliability | OI-REQ-08 | Approved with conditions — versioned per connector instance, ordinal levels not decimals | ACCEPTED |
| [ADR-008](./ADR-008.md) | Policy Outcome Integrity & Policy-Certainty Display | OI-REQ-09 | **Revised** — restored `DENY` as first-class, fail-closed-on-error, added non-overridable hard-deny list | ACCEPTED |
| [ADR-009](./ADR-009.md) | Secret Management Strategy | OI-CTX-08 | Approved unchanged | ACCEPTED |
| [ADR-010](./ADR-010.md) | Deployment Target Strategy | OI-CTX-09 | Approved unchanged | ACCEPTED |
| [ADR-011](./ADR-011.md) | Evidence Retention & Compliance Posture | OI-CTX-10 | **Revised** — indefinite retention replaced with finite, class-differentiated, explicitly dev-only default | ACCEPTED |
| [ADR-012](./ADR-012.md) | Identity Model & Provider Integration for ExecutionAuthorization | OI-CTX-12 | **Revised** — identity *model* now built at MVP; only the external *provider* stays deferred | ACCEPTED |

## A distinction that matters for the four tenant-fact-adjacent ADRs (009, 010, 011, 012)

For OI-CTX-08/09/10/12, the underlying *tenant fact* (which secret manager,
which cloud, which compliance regime, which identity provider) cannot be
resolved by an ADR — only real tenant engagement resolves a fact. What
these ADRs resolve is the **architecture question**: build against a
pluggable interface with a safe default now, defer the concrete
tenant-specific implementation. ADR-012's revision sharpened this further —
"defer the provider" and "defer having any model at all" are not the same
claim, and Revision 1 had conflated them.

## A theme across the review, not just per-ADR fixes

Three corrections recur across multiple ADRs, worth naming once rather than
treating as coincidence: **fail-closed over fail-open** (ADR-004's retry
prohibition, ADR-008's DENY-on-evaluation-failure), **no false precision**
(ADR-003's declarative-only scoring, ADR-007's ordinal levels, ADR-008's
categorical display), and **defer the provider, not the model** (ADR-009's
pattern correctly applied, ADR-012's correction of where it was
mis-applied). Worth carrying these three as standing review criteria for
every future ADR this initiative produces, not just this batch.

## Story Generation gate

**Updated in `pipeline/lld/LLD-v1.md` Revision 2** — corrected here to stay
in sync rather than left stale:

1. All 12 ADRs above are `ACCEPTED` — done, this HIL gate.
2. LLD has resolved OI-REQ-02 (`ContextPackage` shape) and OI-REQ-10
   (version-binding fields) — done, `pipeline/lld/LLD-v1.md` §0.

Both prerequisites are now satisfied. **Tenant-fact items
(OI-CTX-01/02/04/05/06/07) do not block a tenant-neutral MVP story queue** —
Story Gen can produce the MVP queue (webhook, one OPC matcher, state
machine, context assembly, policy, approval, simulated action,
verification, evidence) without knowing who Tenant #1 is. What they block
is narrower: selecting a *real* pilot ticket and building the *real*
context/action connectors — those specific stories, not the queue as a
whole. See LLD-v1.md §8 for the corrected scope.

## Process note (checked, not a defect)

The review flagged a possible repo-mismatch on README links to
`agentic-sdlc-loop`. Verified: `git remote -v` and every commit so far
target `agentic-operations-platform` correctly. The two links in question
(`README.md`'s "Built using the agentic-sdlc-loop framework" section,
`docs/CONTRIBUTING.md`'s "share improvements back upstream" line) are
intentional credits to the upstream framework this repo consumes, not
misplaced references to where these ADRs live. No change made.
