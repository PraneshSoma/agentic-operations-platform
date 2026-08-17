# Discovery Brief — AOP-001

**Phase:** 1 (Discovery) · **Agent:** discovery · **Status:** awaiting HIL gate
**Inputs read:** `context/product-intent/business-ask.md`,
`context/product-intent/vision-and-differentiation.md`,
`context/product-intent/stakeholders.md`,
`context/engineering-context/system-inventory.md`,
`context/engineering-context/technical-constraints.md`. Per
`loop/agents/discovery.md`, `requirements/AOP-001-agentic-operations-platform.md`
(the implementation spec) was deliberately **not** used as a source here — it's
Phase 2's input.

---

## problem_statement

Today, resolving operational and engineering remediation work is either fully
manual — an operator investigates by hand across logs, metrics, and tribal
knowledge, then makes the change themselves, with the reasoning rarely
surviving past the ticket comment thread — or ad hoc AI-assisted, where
someone pastes context into a chatbot and copies its suggestion into a
terminal: faster, but ungoverned, with no policy gate, approval trail,
verification step, evidence record, or authority boundary beyond whatever
access the operator already holds. Neither path scales into something a
platform, security, or compliance organization can stand behind, and neither
produces the evidence trail that makes the next similar ticket faster to
resolve. Agentic Operations Platform closes this gap as a governed
engineering control plane: it takes both operational actions (restart, scale,
reconcile) and engineering changes (code/config fixes, executed through this
repo's own Build loop as a registered action) from intake through composite,
governed context assembly, deterministic policy evaluation, human approval
above R0/R1 risk, governed execution, mandatory post-action verification, and
a complete append-only evidence trail — proving the full loop on one real
Tenant #1 ticket before generalizing to a second, unrelated ticket type with
zero runtime code changes.

## stakeholders

| name_or_role | interest |
|---|---|
| Platform owner | Owns the OPC/connector/action registry, budget ceilings, and autonomy graduation policy; accountable for the runtime staying config-driven — no scenario-specific code creeping in. |
| Security owner | Approves autonomy graduation, R2/R3 policy routes, and secret-handling posture. |
| Senior on-call / SRE | Holds `required_halt_roles` — kill-switch authority over any in-flight execution; likely `approval_route` for R2/R3 mutations. |
| Tenant admin | Configures triggers, OPCs, connectors, actions, and policy per tenant. A config-time role, not a runtime user. |
| Requester | Whoever files the original ticket. Wants it resolved correctly and wants visibility into what happened to it. |
| Compliance / audit | Needs every mutation traceable to an accountable human identity — not just "the platform did it" — and a tamper-evident audit trail. |

## consumers

- **Operations team** — the Operations dashboard view: open requests, investigation status, approvals waiting, executing, escalations.
- **Leadership** — the Leadership Overview: ticket volume, MTTR, automation coverage, engineering hours returned, risk distribution. Explicitly *not* financial-savings figures until the TCO calculation model is defined.
- **Governance/security reviewers** — the Governance view: risk-class breakdown, policy decisions, approval/rollback history, evidence completeness.
- **The next ticket** — every resolved ticket becomes historical evidence/precedent for the next similar one; evidence-before-autonomy makes this a real consumer, not a metaphorical one.
- **Future engineers extending the platform** — the Evidence Ledger, reconstructable per execution, independent of any dashboard.

## pain_points

1. Fully manual resolution is slow, inconsistent, and undocumented — the reasoning behind a fix rarely survives past the ticket comment thread.
2. Ad hoc AI-assisted resolution today is ungoverned: no policy gate, no approval trail, no verification step, no evidence record — the AI's authority is whatever access the operator already holds.
3. Most agentic-SDLC efforts stop at "the agent generated a PR" — they don't close the loop with post-change verification against the original problem, so a plausible-looking change that doesn't actually fix anything can slip through.
4. Neither manual nor ad hoc AI-assisted resolution produces an evidence trail that makes the next similar ticket faster — precedent is lost every time, and the same investigation gets redone from scratch.
5. A bare, model-self-reported confidence score is not trustworthy authority for an approval or autonomy decision — this is a hard design constraint (spec §1.4, §26), not just a pain point to design around.

## in_scope

- Governed resolution of real operational tickets via config-driven Operational Procedure Contracts (OPCs): investigation, diagnosis, planning, policy-gated execution, verification, evidence recording.
- Two registered action kinds under one runtime, one policy engine, one evidence ledger: **operational actions** (restart/scale/reconcile-style) and **engineering-change actions** (code/config fixes executed via this repo's own Build loop — planning → codegen → testgen → rfc — as a governed, policy-gated action type).
- Composite Engineering Context — product intent + engineering context + the spec's `ContextPackage` — as the single governed, bounded context every agent operates against, not ad hoc per-agent context gathering.
- Deterministic policy engine; human approval gates above R0/R1 risk; mandatory post-action verification; append-only, tamper-evident evidence ledger; Control Tower dashboards (Leadership / Operations / Governance / OPC Performance).
- Multi-tenant-safe contracts and data model, with single-tenant-per-deployment as the MVP deployment posture.
- Slack + generic Webhook triggers for v0.1; ServiceNow / PagerDuty / Email as later adapters.
- Proving the full loop end-to-end on **one** real ticket at Tenant #1 first — depth over breadth — then a second, unrelated ticket type running config-only with zero runtime changes.
- Confidence as a deterministic, evidence-itemized rollup (tests, policy checks, independent review, production evidence) — never a bare model self-report.

## out_of_scope

- Building or replacing Tenant #1's existing ticketing, paging, or chat tooling — AOP sits on top of what already exists.
- Removing human approval authority. The v0.2 ceiling is L3 (human-approved execution); L4/L5 autonomous execution is roadmap, not v1.
- Automatic autonomy graduation — `AutonomyGraduationPolicy.enabled` stays `false` everywhere in v0.2.
- General-purpose AI coding assistance. The Build-loop action type resolves one specific, diagnosed `IncomingRequest` under policy/approval/evidence gates — it is not an open-ended coding tool, and a story that can't trace to an incoming request is out of scope regardless of standalone usefulness.
- Full Engineering Context (source-code/ADR/architecture-intent correlation) and Business Context (SLA/blackout windows/regulatory tags) — both explicitly deferred to Phase 2+/3+.
- A standalone Evidence Graph store or a standalone Autonomy Graduation Engine — the relational ledger and the existing policy model are sufficient for v0.2.
- Financial-savings figures on the Leadership dashboard until the TCO calculation model is explicitly defined and real economics inputs (`loop/config/loop.config.json`'s `economics` block) are supplied — currently zeroed.

## open_questions

- **OI-CTX-01**: Who is Tenant #1, concretely — industry, team size, existing on-call maturity? Shapes which OPC (A/B/C) is worth piloting first and what "one real ticket" should actually be. **Blocks Requirements' scope boundaries and Story Gen's Phase D real-connector choice.**
- **OI-CTX-02**: What triggered this initiative — a specific incident, budget/headcount pressure, a compliance mandate, a competitive bet? **Blocks how Requirements frames priority and how Control Tower's capacity/ROI metrics should be pitched to leadership.**
- **OI-CTX-03**: Named individuals/teams for platform owner, security owner, and senior on-call at Tenant #1. **Blocks Governance-phase approval-route config and kill-switch role wiring.**
- **OI-CTX-04**: Does Tenant #1 already have a defined incident-commander/on-call rotation tool? **Affects trigger-adapter priority beyond the v0.1 Slack/Webhook pair.**
- **OI-CTX-05**: Which system is Tenant #1's actual ticketing/ITSM tool today? **Blocks whether the v0.1 Webhook adapter is a real bridge to something specific.**
- **OI-CTX-06**: What logs/metrics platform(s) does Tenant #1 already run? **Blocks the "one real context connector" choice and its staleness tuning.**
- **OI-CTX-07**: What's the first real mutation worth automating at Tenant #1? **Needs a real candidate ticket type to pick meaningfully between OPC A/B/C.**
- **OI-CTX-08**: Existing secret manager and cloud platform in use at Tenant #1 (or for this platform's own deployment). **Blocks which concrete `SecretResolver` implementation gets built first.**
- **OI-CTX-09**: Target deployment environment — cloud provider, container orchestration, existing CI/CD. `infra/docker-compose.yml` only covers local dev today.
- **OI-CTX-10**: Compliance/regulatory regime in scope (SOC 2, HIPAA, PCI, none yet). **Affects audit-log retention requirements beyond the spec's append-only baseline.**
- **OI-CTX-11**: Data residency constraints, if any — relevant once a second tenant/region is in play, not blocking for MVP.
- **OI-CTX-12**: Existing identity provider for human approvers/requesters. **Relevant to `ExecutionAuthorization.identity` resolving to a real accountable identity.**

Two related questions are **not** listed above because they belong to Design,
not Discovery/Requirements — noted here so they aren't lost, not because
they're blocking this brief: exactly how the code-change `ActionConnector`
invokes the Build loop (a full scoped pipeline run vs. a lighter direct
call), and how its risk class is computed differently from an ops action's
blast radius. Both are explicitly ADR-level per
`context/product-intent/vision-and-differentiation.md`.

---

## Validation

- [x] Problem statement is concrete, not generic — names both failure modes (manual, ad hoc AI) and what closes the gap.
- [x] Every consumer of the current/target system listed (5, from `stakeholders.md`).
- [x] Scope boundaries explicit — 8 in_scope bullets, 7 out_of_scope bullets.
- [x] Unknowns captured as numbered open items — all 12 `OI-CTX` items carried forward verbatim, none silently resolved.

## Note on budget/telemetry

`loop/config/loop.config.json`'s budget and telemetry machinery
(`per_agent_tokens`, `telemetry/events.ndjson`) governs the *automated*
pipeline once it's actually running as software. This particular Discovery
pass was produced directly in this conversation rather than through an
instrumented pipeline run, so there's no real token/cost figure to report
here — reporting a fabricated one would defeat the point of the real-numbers
guardrail. Once Iteration 2's durable orchestrator exists, actual pipeline
runs will carry real telemetry.
