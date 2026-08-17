# Requirements — AOP-001

**Phase:** 1 (Discovery → Requirements) · **Agent:** requirements · **Status:** REVISION 2, awaiting HIL gate
**Inputs read:** `pipeline/discovery_brief.md` (approved) +
`requirements/AOP-001-agentic-operations-platform.md` (the implementation
spec). Every `F-##`/`NFR-##` cites the spec section it derives from.

**Revision note:** v1 of this document was reviewed and returned with
`REVISE`. The review's core finding: the *content* was right but the
*artifact* didn't expose enough structure for someone to approve it with
confidence — unresolved items buried in prose, no MVP/target-state
separation (risking a "build everything" Story Gen pass), one requirement
(F-07) actually an epic in disguise, rollback implied universally available
when the spec's own model doesn't support that, a confidence requirement
that invited a vague percentage, no explicit failure/recovery semantics, no
version-binding requirement for replayability, and genericity buried as an
NFR instead of a release gate. This revision addresses all nine points
directly, in place — nothing below is new scope, it's the same 17
requirements decomposed, classified, and made unambiguous.

---

## Classification legend

Every requirement below is tagged with exactly one of:

- **MVP** — required for the one-real-ticket, end-to-end proof (discovery
  brief's "depth over breadth" directive). Minimal working slice: webhook
  trigger, one OPC matcher, state machine, context assembly, policy,
  approval, a **simulated** action connector (proves the governed pipeline
  without needing a real production mutation yet), verification, evidence.
- **Post-MVP** — real-world hardening once the MVP slice is proven: real
  operational action execution, OBO identity delegation, engineering-change
  (code-fix) action initiation, sophisticated/compensating rollback,
  multi-view Control Tower.
- **Invariant** — true from the first line of code, regardless of MVP/Post-MVP
  status. Never sequenced, never deferred: tenant isolation, read/write
  separation, secrets exclusion, deterministic policy/authorization,
  full auditability.
- **Extension point** — proves its value through pluggability, not through
  being fully populated: additional trigger/context/action connectors beyond
  the first of each kind, independent/cross-model review as a pluggable
  evaluator. The registry pattern itself is MVP; having many entries in it
  is not.

A requirement can carry an invariant *sub-clause* even while its main body is
Post-MVP (e.g., F-14's reversible/irreversible gate is invariant even though
its compensating-rollback machinery is Post-MVP) — tags apply per AC bullet
where they diverge, noted inline.

---

## Functional

**F-01 — Trigger ingestion & normalization** `MVP` (spec §4.1, §5)
- AC (MVP): a webhook POST produces a schema-valid `IncomingRequest`.
- AC (Post-MVP): Slack adapter — spec lists it as v0.1, but it's not on the
  critical path to one working end-to-end ticket the way webhook is (Slack
  also doubles as the v0.1 approval UI, §18, which itself is Post-MVP-tagged
  under F-06's approval-gate — a bare API call suffices for MVP approval).
  Re-scoped narrower than the spec's own v0.1 line on purpose — see note on
  F-01 in the Open Item Register if this is wrong for the actual pilot ticket.
- AC (Invariant): the raw trigger payload is preserved separately; no
  trigger-specific field is readable outside the trigger adapter.

**F-02 — OPC matching with deterministic ambiguity guardrail** `MVP` (spec §6, §6A)
- AC (MVP): the matching mechanism — exact filters, semantic fallback,
  margin-bounded ambiguity guardrail — works correctly against **one**
  configured OPC.
- AC (Invariant): an intentionally ambiguous ticket (margin below
  `minimum_required_margin`) yields `AMBIGUOUS_ESCALATE`, never an auto-pick;
  `OPCMatchResult` (all candidates, not just the winner) is written to the
  Evidence Ledger unconditionally.
- AC (Post-MVP / Release Acceptance): proving this against ≥3 structurally
  different OPCs is its own gate — see "Release Acceptance Tests" below, not
  bundled into MVP-done.

**F-03 — Durable orchestrator state machine** `MVP` core / see Failure & Recovery below (spec §7)
- AC (Invariant): every transition persists state, emits a `PlatformEvent`,
  and writes an `Evidence` record — all three, same order, every time.
- AC (Invariant): re-delivering the same trigger is a no-op (idempotency key
  = `tenant_id + request_id`, spec §31) — **prevents duplicate executions
  from duplicate/retried triggers.**
- **Failure & recovery AC (MVP unless noted) — each of these must be an
  explicit, testable behavior, not an implicit property of "idempotent":**
  - *Worker crash after an external mutation but before the transition
    persists*: on restart, the orchestrator must check the target action's
    provider status (via `preflight`/idempotency key) **before** ever
    re-invoking `execute()` for that step — never blind-retry a mutation
    whose outcome is unknown. `Post-MVP` for the real-connector case (needs
    F-18); the *mechanism* (check-before-retry) is architected in from day
    one. **Left open — see OI-REQ-06.**
  - *Expired approval*: `EXPIRED → ESCALATE` (spec §30). `MVP`.
  - *Action timeout with unknown result*: do not blindly retry; check
    idempotency and provider status first (spec §30). `MVP` mechanism,
    exercised for real once F-18 exists.
  - *Connector partial failure*: required context missing → `ESCALATE`;
    optional → continue with `missing_context` populated (spec §30). `MVP`.
  - *Stale policy/OPC version mid-flight*: an execution pins the
    `opc_version`/policy version it started with at `OPC_MATCHED`; a later
    publish of a new version never silently changes an in-flight execution's
    behavior. If the pinned version is retired before completion, that's
    surfaced as an explicit condition, not silently ignored. `MVP`.
  - *Verification inconclusive*: `ESCALATE`, ticket never marked resolved
    (spec §30). `MVP`.
  - *Retry after a possibly-successful execution*: same rule as "unknown
    result" above — idempotency key blocks a second real mutation; a retry
    is a status check, not a re-execution, unless the idempotency key proves
    it's safe. `MVP` mechanism.
  - *Ledger unavailable*: if the `Evidence` write itself fails, the
    transition as a whole is treated as failed and retried — RULE 7's "all
    three, every time" means an evidence-write failure is **not** a
    degraded-but-acceptable outcome. Exact durability mechanism (e.g.
    outbox pattern) is genuinely open — **see OI-REQ-07.** `MVP`
    requirement, `Post-MVP` for the hardened mechanism if outbox-pattern
    complexity isn't justified for the pilot.
  - *Kill switch triggered mid-execution*: spec §7A already fully specifies
    this (cancellation attempted, not assumed; no auto-rollback; transitions
    to `ESCALATED_HUMAN_OVERRIDE`) — cited here, not restated. `MVP`
    (F-11 covers it).

**F-04 — Context Package assembly** `MVP` (spec §8-10)
- AC (MVP): `ContextPackage.missing_context` lists any required-but-unavailable
  source; stale connector results are marked per `staleness.on_exceeded`.
- AC (Invariant): raw logs never enter the package; summaries link back to
  original evidence.

**F-05 — Investigator agent** `MVP` (spec §11)
Not named explicitly in the discovery brief's MVP list, but load-bearing —
there's no path from "context assembly" to "policy" without it. Included as
MVP by inference; flag if that inference is wrong.
- AC (Invariant): every factual claim in the diagnosis traces to an
  `evidence_id` — no invented connector results.

**F-06 — Planner agent and the Frozen Plan Rule** `MVP` (spec §12)
Same inference basis as F-05 — necessary to reach "approval."
- AC (Invariant): after approval, the executor cannot add or substitute an
  action outside the approved plan; a changed parameter forces re-approval.

**F-07 — Versioned Action Registry** `MVP` (spec §13) — **narrowed from v1**
Registry/versioning mechanics only. What gets registered and how it executes
now lives in F-18/F-19 below — this requirement no longer describes an epic.
- AC (MVP): `ActionDefinition` is versioned; `status: active | disabled`;
  lookup is always by `tenant_id` + `action_ref` + `version`.
- AC (Invariant): every `ActionDefinition` — regardless of kind — validates
  and executes through the identical `ActionConnector` interface
  (`validateAction`/`preflight`/`execute`/optional `rollback`). No runtime
  code path branches on "what kind of action is this" — the distinction
  lives entirely in registered config data (CONTEXT.md RULE 8).

**F-08 — Deterministic Policy Engine** `MVP` core, `Invariant` determinism (spec §15-16)
- AC (MVP): a `ProposedAction` evaluates to `ALLOW`/`REQUIRE_APPROVAL`/`DENY`
  against at least one real policy rule.
- AC (Invariant): the same `ProposedAction` + policy version, evaluated
  twice, produces a byte-identical `PolicyDecision`. No LLM call, no
  wall-clock read, nothing non-reproducible inside evaluation.
- AC (informed by compensation class, see below): `REQUIRE_APPROVAL` routing
  may consider an action's compensation class (REVERSIBLE/COMPENSATABLE/
  IRREVERSIBLE) alongside risk class — an IRREVERSIBLE action warrants a
  stricter default route even at the same nominal risk class. `Post-MVP`
  refinement; `MVP` policy evaluation works without it, just more coarsely.

**F-09 — Execution identity & delegation (OBO)** `Post-MVP` (spec §14A)
MVP's simulated action connector is R0/R1 by construction (no real
production impact), so the OBO-for-R2/R3 requirement doesn't bind yet —
`SERVICE_ACCOUNT` mode is sufficient until F-18's real, higher-risk actions
exist.
- AC (Post-MVP): at least one R2-class action executes under `ON_BEHALF_OF`,
  recorded executor identity matching the human approver, not the platform
  service account.
- AC (Invariant, once R2/R3 actions exist): `approver_ref` mismatch between
  OBO identity and the actual `ApprovalDecision` actor is rejected by the
  executor, unconditionally.

**F-10 — Pre-execution drift check (preflight)** `MVP` mechanism, `Post-MVP` real-world exercise (spec §14B)
- AC (MVP): the `MATCH`/`DRIFTED`/`UNKNOWN` preflight machinery exists and
  is exercised against the simulated connector's (simulated) preconditions.
- AC (Invariant): `DRIFTED` blocks execution — never proceeds silently;
  `UNKNOWN` (preflight failure) is treated as missing required context, not
  an implicit pass.
- AC (Post-MVP): a deliberately staged drift against a **real** system,
  caught and blocking — meaningful once F-18 exists.

**F-11 — Emergency halt / kill switch** `MVP` (spec §7A)
Cheap to prove even against a simulated execution, and directly demonstrates
"safety treated systemically" — kept in MVP rather than deferred.
- AC (MVP): halting an in-flight execution transitions it to
  `ESCALATED_HUMAN_OVERRIDE` with an auditable `Evidence` record and
  `execution.halted` event.
- AC (Invariant): halt never attempts automatic rollback on an
  already-completed action — surfaces for human decision instead.

**F-12 — Token & cost governance** `MVP` (spec §7B)
Tightly coupled to F-03's state machine; applies to investigation/planning
token spend regardless of whether the eventual action is simulated or real.
- AC (Invariant): an execution exceeding its configured budget escalates
  with `BUDGET_EXCEEDED` — never silently truncates and presents a partial
  diagnosis as complete.

**F-13 — Verification Engine** `MVP` (spec §19)
- AC (Invariant): `FAILED`/`INCONCLUSIVE` never marks the ticket resolved;
  `recommended_next_step` is always populated.
- AC (informed by compensation class): `recommended_next_step: ROLLBACK` is
  only ever offered for `REVERSIBLE`/`COMPENSATABLE` actions — never for
  `IRREVERSIBLE` ones, which escalate directly regardless of verification
  outcome.

**F-14 — Rollback Manager, by compensation class** `MVP` gate / `Post-MVP` compensating flows (spec §20) — **reworked from v1**

v1 implied rollback was uniformly available whenever `reversible: true`.
That's not accurate even within the spec's own domain (an ops action's
instant technical reversal and a code change's git-revert-then-re-review
cycle are not the same shape), so this requirement now defines three
compensation classes, extending spec §13's boolean `reversible` field —
**flagged as needing formal ADR/LLD treatment, see OI-REQ-05:**

- **REVERSIBLE** — a direct, instant technical reversal exists (e.g. flip a
  feature flag back). May be auto-executed per policy without a fresh
  approval cycle, same authorization model as forward execution (spec §20).
- **COMPENSATABLE** — no instant reversal exists, but a corrective action
  can be proposed. Critically: **the compensating action is itself a new,
  fully governed `ProposedAction`** — it goes through planning, policy, and
  approval again, not an automatic bypass. A code-change action's "rollback"
  (a revert commit that still needs tests, review, and its own merge/deploy
  cycle) is the canonical example — it is not equivalent to an ops
  connector's instant rollback, and must never be represented as such.
- **IRREVERSIBLE** — no rollback path exists. Verification failure on an
  IRREVERSIBLE action escalates to a human immediately; rollback is never
  attempted, automatically or otherwise.
- AC (MVP): the three-class distinction exists in the `ActionDefinition`
  schema (extending, not replacing, `reversible`/`rollback_action_ref`) and
  the simulated MVP action is explicitly classed.
- AC (Post-MVP): a real COMPENSATABLE flow (the code-change git-revert case)
  demonstrably re-enters the full governed pipeline rather than executing
  as a shortcut.

**F-15 — Evidence Ledger** `MVP`, `Invariant` (spec §21, §4.6, §23)
- AC (Invariant): a correction to an evidence record creates a new record
  with `relationships.supersedes` set — never an in-place update.
- AC (Invariant): a query against any evidence/execution table, run against
  a two-tenant-seeded database, returns zero rows for the tenant not
  specified — regardless of table.

**F-16 — Control Tower** `MVP` minimal / `Post-MVP` multi-view (spec §27-28, §34)
- AC (MVP): an execution's complete history is reconstructable from Evidence
  Ledger records alone — this is a named §34 acceptance criterion and does
  not require a polished dashboard to satisfy, just a working read path.
- AC (Post-MVP): the four distinct views (Leadership/Operations/Governance/
  OPC Performance) — "multi-channel Control Tower" per the review.
- AC (Invariant, once financial figures ever appear): no financial-savings
  figure is presented until the TCO formula is explicitly filled in.

**F-17 — Evidence-based confidence, decomposed by dimension** `MVP` dimensions / `Post-MVP`-gated numeric rollup (spec §26) — **reworked from v1**

v1's "evidence-itemized rollup" was still, in the end, one number. Per
review: a single percentage is dangerous unless calibrated and reproducible
— so the numeric rollup is now explicitly gated, and the dimensions it would
be built from are named individually, most of which already have a home in
existing contracts rather than being new engineering:

| Dimension | Existing contract hook | New? |
|---|---|---|
| Evidence coverage | §26 `ReasoningAssessment.evidence_coverage` (HIGH/MEDIUM/LOW) | No |
| Hypothesis support | §11 `InvestigationResult.hypotheses[].status` + supporting evidence | No |
| Contradictory evidence | §4.6 `Evidence.relationships.contradicts` | No |
| Verification confidence | §19 `VerificationResult.checks[].status` pass/fail/unknown ratio | No |
| Evidence freshness | §10 `ContextPackage` staleness marking | No (different lens on an existing field) |
| Source reliability | — | **Yes — undefined, see OI-REQ-08** |
| Policy certainty | — (candidate mapping: `ALLOW` outright vs. `REQUIRE_APPROVAL` as a certainty signal) | **Yes — undefined, see OI-REQ-09** |

- AC (MVP): all five already-defined dimensions are surfaced individually,
  itemized, alongside any decision — never collapsed into a single figure.
- AC (Post-MVP, hard-gated): a single numeric confidence figure is **only**
  displayed once empirically calibrated against a defined minimum number of
  historical verified outcomes (spec §26's own calibration requirement).
  Before that threshold is met, the itemized dimensions are the entire
  confidence surface — there is no percentage to show, and none is
  fabricated to fill the gap.

**F-18 — Operational Action Execution** `MVP` = simulated connector, `Post-MVP` = real connector (spec §13-14) — **split from v1's F-07**
- AC (MVP): a **simulated** `ActionConnector` — implementing the full
  interface (`validateAction`/`preflight`/`execute`/`rollback`) against a
  fake/sandboxed target — proves the complete governed pipeline
  end-to-end without a real production mutation.
- AC (Post-MVP): a real operational connector (Iteration 4 shape — restart/
  scale/reconcile-style) executes against a real Tenant #1 system, with real
  preflight drift and real verification.

**F-19 — Engineering-Change Action Initiation** `Post-MVP` (spec §13-14; scope decision in `context/product-intent/vision-and-differentiation.md`) — **split from v1's F-07**
- AC (Post-MVP): a code/config-change `ActionConnector` triggers this
  repo's own Build loop, scoped to a single story — never the initiative's
  full queue — as a governed action.
- AC (Invariant, once built): no runtime code path special-cases "this is a
  code fix" — same registry/interface discipline as F-07/F-18.
- AC (Post-MVP, ties to F-14): rollback for this action kind is
  COMPENSATABLE, not REVERSIBLE — a revert PR that re-enters the full
  governed pipeline, not an instant reversal.
- **Invocation mechanism is explicitly open — see OI-REQ-03.**

**F-20 — Immutable version binding for replayability** `MVP` (new — not in v1)
Per review: without binding every execution to the exact versions/hashes it
ran against, replayability and auditability are incomplete even with F-15's
append-only ledger. Most pieces already exist scattered across contracts;
this requirement is that they're captured **together**, per execution:

| Element | Existing hook | New? |
|---|---|---|
| OPC id + version | §7 `ExecutionState.opc_id`/`opc_version` | No |
| Action definition + version | §4.3 `ProposedAction.action_ref`/`action_version` | No |
| Policy bundle version | §4.4 `PolicyDecision.policy_version` | No |
| Frozen plan | §12 `ResolutionPlan.plan_id` | No |
| Approval | §18 `ApprovalDecision.approval_id` | No |
| Model + prompt version | §4.3 `ProposedAction.generated_by` | No |
| Context connector definition version | — | **Yes** |
| Executor implementation version/build hash | — | **Yes** |
| Evidence snapshot | §4.6 `Evidence` records, joined by `execution_id` | No (already reconstructable, per F-16) |

- AC (MVP): a single query/view, given an `execution_id`, returns every
  element in the table above — the ones that already exist as fields today,
  joined; not a new write path, a new **read guarantee**.
- AC (Post-MVP / open): the two "new" rows need a home — **see OI-REQ-10**
  for which contract gains a `connector_definition_version` /
  `executor_build_hash` field.

---

## Non-functional

All eight are **Invariant** — none of these were ever candidates for
Post-MVP sequencing, and the review didn't ask for that; restated here with
the tag for consistency with the functional list.

**NFR-01 — Config-driven, not scenario-driven** `Invariant` (spec §1.1)
**NFR-02 — Read/write connector separation is structural** `Invariant` (spec §1.3, §10)
**NFR-03 — Secrets never enter agent/LLM context** `Invariant` (spec §24)
**NFR-04 — Multi-tenant-safe persistence** `Invariant` (spec §23)
**NFR-05 — Deterministic policy evaluation as a systemic property** `Invariant` (spec §16)
**NFR-06 — Full auditability** `Invariant` (spec §7, §21, §22, §34)
**NFR-07 — No hard dependency on a specific orchestration framework** `Invariant` (spec §7)
**NFR-08 — Genericity across OPCs** `Invariant` design constraint — **promoted to an explicit release gate, not left as an NFR alone; see "Release Acceptance Tests" below.**

(AC text unchanged from v1 for NFR-01 through NFR-07 — the review's
NFR-related finding was specifically about NFR-08, addressed below.)

---

## Release Acceptance Tests

Distinct from per-requirement AC and from MVP-done: these are the gates
before treating the platform as proven-generic, run once Post-MVP items
(specifically F-19) exist — **not** part of the MVP-done bar.

**RAT-01 — Three structurally different OPCs, zero runtime branching**
Per review, promoted from NFR-08 alone into an explicit test: the same
runtime must execute at least three *structurally* different OPCs — not just
three different business domains — without scenario-specific branching or
runtime code changes:

1. **Diagnostic-only** — investigate and report, no mutating action at all.
2. **Approval-gated operational mutation** — the MVP/F-18 shape, real
   connector.
3. **Engineering-change / draft-PR initiation** — the F-19 shape.

Passing requires F-18 (real) and F-19 both to exist — this test is
inherently Post-MVP, and is a sharper proof than the original spec's OPC
A/B/C triad (which varies by business domain, not by architectural shape).

---

## Open Item Register

Every unresolved item, in one place, with a traceable blocking relationship
— replacing v1's "carried forward but not restated" prose, per the review's
core finding. Full source detail stays in `discovery_brief.md` /
`vision-and-differentiation.md`; this table is the decision surface.

| ID | Summary | Blocking stage | Owner | Resolution artifact |
|---|---|---|---|---|
| OI-CTX-01 | Who is Tenant #1 (industry, size, on-call maturity) | Story Gen (OPC pilot choice) | TBD | Tenant onboarding brief |
| OI-CTX-02 | What triggered this initiative | Requirements framing / leadership pitch | TBD | Product brief update |
| OI-CTX-03 | Named platform owner / security owner / senior on-call | Governance config, Build | TBD | Tenant policy config |
| OI-CTX-04 | Tenant's existing on-call/paging tool | Story Gen (trigger adapter priority) | TBD | Tenant onboarding brief |
| OI-CTX-05 | Tenant's real ticketing/ITSM system | Story Gen, Build | TBD | Tenant onboarding brief |
| OI-CTX-06 | Tenant's logs/metrics platform | Build (F-18 real connector) | TBD | Tenant onboarding brief |
| OI-CTX-07 | First real mutation worth automating | Story Gen (OPC pilot choice) | TBD | Tenant onboarding brief |
| OI-CTX-08 | Tenant's secret manager / cloud platform | ADR, Build | TBD | ADR (`SecretResolver`) |
| OI-CTX-09 | Target deployment environment | ADR, Infra | TBD | ADR (deployment) |
| OI-CTX-10 | Compliance/regulatory regime | ADR (evidence retention) | TBD | ADR (retention) |
| OI-CTX-11 | Data residency constraints | Post-MVP (multi-region) | TBD | ADR (multi-region) |
| OI-CTX-12 | Tenant's identity provider | ADR (F-09 OBO) | TBD | ADR (identity) |
| OI-REQ-01 | Independent/cross-model review has no formal contract | ADR (F-17) | TBD (Architect) | ADR |
| OI-REQ-02 | `ContextPackage`: explicit sub-objects vs. joined contracts | LLD (F-04) | TBD (Architect) | LLD |
| OI-REQ-03 | Build-loop invocation mode (full pipeline run vs. lighter call) | ADR (F-19) | TBD (Architect) | ADR |
| OI-REQ-04 | Risk-class computation for code-change actions | ADR (F-19, F-08) | TBD (Architect) | ADR |
| OI-REQ-05 | Compensation-class schema — extends spec's boolean `reversible` | ADR/LLD (F-14) | TBD (Architect) | ADR |
| OI-REQ-06 | Recovery: worker crash after mutation, before persistence | ADR (F-03) | TBD (Architect) | ADR |
| OI-REQ-07 | Durability when the Evidence Ledger write itself fails | ADR (F-03, F-15) | TBD (Architect) | ADR |
| OI-REQ-08 | "Source reliability" confidence dimension — undefined | ADR (F-17) | TBD (Architect) | ADR |
| OI-REQ-09 | "Policy certainty" confidence dimension — undefined | ADR (F-17) | TBD (Architect) | ADR |
| OI-REQ-10 | Version-binding: which contracts gain connector-definition-version / executor-build-hash fields | LLD (F-20) | TBD (Architect) | LLD |

---

## Out of scope

Unchanged from v1's substance:

- Replacing Tenant #1's existing ticketing/paging/chat tooling.
- Autonomous execution above L3 (spec §17.1) — `AutonomyGraduationPolicy.enabled` stays `false` everywhere.
- General-purpose AI coding assistance — every code-change action must trace to an `IncomingRequest` (F-19).
- Full Engineering Context (spec §36) and Business Context (spec §37).
- A standalone Evidence Graph store and a standalone Autonomy Graduation Engine (spec §39).
- Financial-savings figures on the Leadership dashboard until the TCO formula is defined.

---

## Validation

- [x] Every F-/NFR- item has testable AC and cites its spec section.
- [x] Every item classified MVP / Post-MVP / Invariant / Extension point.
- [x] F-07 split into registry (F-07) + operational execution (F-18) + engineering-change initiation (F-19) — no longer an epic-in-disguise.
- [x] Rollback reworked into three compensation classes (REVERSIBLE/COMPENSATABLE/IRREVERSIBLE); no longer implies universal availability.
- [x] Confidence (F-17) decomposed into seven named dimensions; numeric rollup explicitly gated behind calibration, never a bare/vague percentage.
- [x] Failure & recovery scenarios (10, per review) made explicit under F-03's AC, not left implicit.
- [x] Immutable version binding (F-20) added as its own requirement.
- [x] Genericity promoted from NFR-08 alone to an explicit Release Acceptance Test (RAT-01), with a sharper three-shape triad than the spec's own OPC A/B/C.
- [x] Every open item — 12 carried, 10 new — in one traceable register with blocking stage, owner, and expected resolution artifact.
