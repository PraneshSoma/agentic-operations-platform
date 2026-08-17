# Stakeholders & Consumers

> Feeds Discovery's `stakeholder_docs` input (`loop/agents/discovery.md`).
> Roles below are the ones the spec itself already requires the platform to
> address (policy routes, approval actors, dashboard audiences) — named
> individuals are `OI-CTX` items, not invented here.

## Stakeholders (interest in how the platform is built/governed)

| Role | Interest | Spec anchor |
|---|---|---|
| **Platform owner** | Owns the OPC/connector/action registry, budget ceilings, autonomy graduation policy. Accountable for the runtime staying config-driven (no scenario-specific code creeping in). | §3.1, §17 `required_approver_roles` |
| **Security owner** | Approves autonomy graduation, R2/R3 policy routes, secret-handling posture. | §17 `required_approver_roles`, §24 |
| **Senior on-call / SRE** | `required_halt_roles` — can invoke the kill switch on any in-flight execution. Also a likely `approval_route` for R2/R3 mutations. | §7A, §16 example rule |
| **Tenant admin** | Configures triggers, OPCs, connectors, actions, policy per tenant. Not a runtime user — a config-time one. | §3.1 |
| **Requester** | Whoever files the original ticket (`IncomingRequest.requester`) — Slack user, ServiceNow submitter, etc. Wants their ticket resolved correctly and to know what happened to it. | §4.1 |
| **Compliance / audit** | Needs every mutation traceable to an accountable human identity (not just "the platform did it"), and a tamper-evident audit trail. | §14A, §21, §22 |

## Consumers (of the platform's output)

| Consumer | Consumes | Spec anchor |
|---|---|---|
| **Operations team** | The Operations dashboard view — open requests, investigation status, approvals waiting, executing, escalations. | §28 |
| **Leadership** | The Leadership Overview — ticket volume, MTTR, automation coverage, engineering hours returned, risk distribution. Explicitly *not* financial-savings numbers until the calculation model is defined (§27.1). | §27.1, §28 |
| **Governance/security reviewers** | The Governance view — risk-class breakdown, policy decisions, approval/rollback history, evidence completeness. | §28 |
| **The next ticket** | `HistoricalEvidenceContext` — every resolved ticket becomes precedent for the next similar one. Evidence-before-autonomy (§1.4) makes this consumer as real as the human ones. | §8, §17 |
| **Future engineers extending the platform** | The Evidence Ledger, reconstructable per execution — "control tower reconstructs an execution from evidence" is a §34 acceptance criterion in its own right, independent of any dashboard. | §21, §34 |

## Open items

- **OI-CTX-03**: Named individuals/teams for platform owner, security owner,
  and senior on-call at Tenant #1 — needed for `required_halt_roles` and
  `required_approver_roles` config, not just the role definitions above.
  Blocks: Iteration 3 (Governance) approval-route config, Iteration D-05
  (kill switch) role wiring.
- **OI-CTX-04**: Does Tenant #1 already have a defined incident-commander /
  on-call rotation tool (PagerDuty, Opsgenie, homegrown)? Affects trigger
  adapter priority beyond the v0.1 Slack/Webhook pair (spec §5's "later
  adapters" list).
