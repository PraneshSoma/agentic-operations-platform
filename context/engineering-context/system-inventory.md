# System Inventory

> Feeds Discovery's `system_inventory` input and ADR's `architecture_context`
> input (`loop/agents/discovery.md`, `loop/agents/adr.md`).

This is what already exists that the platform has to trigger from, read
context from, or act on — as distinct from what the platform itself is
building (see `CONTEXT.md` for that). Nothing below is scenario-specific
runtime logic (spec §1.1 still holds — these are connector/trigger *targets*,
config, never code branches).

## Trigger sources the spec already commits to (§5)

| System | Status | Notes |
|---|---|---|
| Slack | v0.1 initial adapter | Also the v0.1 approval UI (§18) — "Slack is one approval UI, not the approval system." |
| Generic Webhook | v0.1 initial adapter | Unopinionated fallback for anything without a dedicated adapter yet. |
| ServiceNow | Later adapter | Named explicitly in §5 and referenced throughout as the archetypal ITSM tool this platform integrates with. |
| PagerDuty | Later adapter | Named explicitly in §5. |
| Email | Later adapter | Named explicitly in §5. |

## Context connector targets (§8, §10)

The spec is explicit that context types (Application/Runtime/Historical
Evidence) are generic shapes — but *some* real system has to back the first
real connector in Iteration 4 (§38). Candidates implied by the domain:
logs/metrics platforms (type: `logs`/`metrics`), a deployment/CI system for
`change_context` (§8.1's "thin connector against a deployment/CI system's
API"), and whatever holds `ApplicationContext` today (a service catalog, a
CMDB, or just config).

## Action connector targets (§13-14)

Same shape question, for writes: what production system does the *first*
real `ActionConnector` (Iteration 4) point at? The spec's OPC B (Production
Error Spike, §35) implies a "registered remediation" against a running
service — restart, scale, feature-flag flip, or similar — but doesn't name
the target system, because it can't; that's this tenant's specifics.

## Platform-adjacent infra already assumed by the spec

- **Secret manager** — §24 requires secrets be references, never inline; some
  concrete secret manager (AWS Secrets Manager, Vault, ...) has to back
  `SecretResolver` (see `CONTEXT.md`).
- **A relational store** — §32 is explicit this is Postgres-shaped; already
  decided in `CONTEXT.md`/`README.md` (PostgreSQL via Prisma).

## Open items

- **OI-CTX-05**: Which system is Tenant #1's actual ticketing/ITSM tool
  today — ServiceNow, Jira Service Management, something homegrown? Not yet
  named anywhere. Blocks: whether the v0.1 Webhook adapter is a real bridge
  to something specific or stays generic through Iteration 4.
- **OI-CTX-06**: What logs/metrics platform(s) does Tenant #1 already run
  (Datadog, Splunk, CloudWatch, Prometheus/Grafana, ...)? Blocks: the
  Iteration 4 "one real context connector" choice (spec §38) and the
  Runtime Context connector's `staleness.max_age_seconds` tuning (§10).
- **OI-CTX-07**: What's the first real mutation worth automating at
  Tenant #1 — i.e. what should the Iteration 4 "one real action connector"
  actually point at? Needs a real candidate ticket type, not a hypothetical
  one, to pick meaningfully between OPC A/B/C (§35).
- **OI-CTX-08**: Existing secret manager and cloud platform in use at
  Tenant #1 (or for this platform's own deployment). Blocks: which concrete
  `SecretResolver` implementation Iteration 3+ builds first (`CONTEXT.md`
  currently defaults to "AWS Secrets Manager to start" as a placeholder, not
  a confirmed decision).
