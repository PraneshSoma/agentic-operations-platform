# Engineering Context — Agentic Operations Platform

> Engineering orientation for contributors, reviewers, demos, and
> source-grounded technical presentations. This document describes how the
> implemented system fits together and distinguishes production architecture
> from local-demo substitutions. The normative sources remain
> `requirements/AOP-001-agentic-operations-platform.md` and `CONTEXT.md`.

## Engineering objective

AOP is a multi-tenant-safe, config-driven control plane for governed
operational work. It normalizes incoming incidents, assembles bounded context,
matches an Operational Procedure Contract (OPC), produces an evidence-grounded
diagnosis and frozen plan, evaluates deterministic policy, obtains human
approval when required, executes only registered actions, verifies the outcome,
and records the full chain of evidence.

The central engineering invariant is:

```text
Agents propose; deterministic runtime controls authorize and execute.
```

No model-facing path may directly mutate a production system.

## System shape

```text
Slack / Webhook / UI
         │
         ▼
 Trigger normalization ──► IncomingRequest
         │
         ▼
 OPC matching ──► Context assembly ──► Investigation ──► Frozen plan
                                                        │
                                                        ▼
                                             Deterministic policy
                                                        │
                                      ┌─────────────────┴──────────────┐
                                      ▼                                ▼
                                Human approval                    Auto-authorized
                                      └─────────────────┬──────────────┘
                                                        ▼
                                             Preflight + execution
                                                        │
                                                        ▼
                                                Verification engine
                                                        │
                                                        ▼
                                       Evidence ledger + Control Tower
```

Every runtime transition persists state, emits a platform event, and appends
evidence. Execution success and remediation success are separate: an action is
not considered resolved until verification confirms the intended outcome.

## Workspace architecture

### Applications

| Workspace            | Responsibility                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api`           | Fastify API for trigger webhooks, approvals, onboarding, status checks, and Control Tower reads.                                                             |
| `apps/worker`        | Governed orchestration, state transitions, investigation, planning, budget control, crash recovery, and emergency halt behavior.                             |
| `apps/control-tower` | Interactive operations console, SSE transport, Slack event/interactivity callbacks, demo orchestration, onboarding UI, and customer-domain demo integration. |
| `apps/demo`          | Deterministic command-line demonstration of the governed pipeline.                                                                                           |

### Domain packages

| Workspace                      | Responsibility                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`           | Zod schemas and inferred TypeScript types for every runtime boundary. Imports no platform logic.                                   |
| `packages/context-service`     | Read-only context connectors and bounded Context Package assembly.                                                                 |
| `packages/policy-engine`       | Deterministic OPC matching, hard-deny rules, policy evaluation, and approval acceptance.                                           |
| `packages/action-executor`     | Registered write connectors, frozen-plan checks, preflight, idempotent execution markers, rollback decisions, and gated execution. |
| `packages/verification-engine` | Post-action checks and outcome classification.                                                                                     |
| `packages/evidence-ledger`     | Prisma/PostgreSQL persistence, append-only evidence, outbox delivery, retention, activation, and Control Tower read models.        |
| `packages/confidence`          | Itemized evidence dimensions and role-separated review; never a fabricated single confidence percentage.                           |
| `packages/identity`            | Human and service-principal resolution, including a local development implementation.                                              |
| `packages/secrets`             | Secret reference resolution; resolved values never enter prompts, evidence, or logs.                                               |

## Runtime lifecycle

The user-facing lifecycle is:

```text
DETECT → DIAGNOSE → PLAN → APPROVE → REMEDIATE → VERIFY
```

The detailed execution state progression is:

```text
RECEIVED → OPC_MATCHED → CONTEXT → DIAGNOSED → PLANNED →
WAITING_APPROVAL → APPROVED → EXECUTING → VERIFYING → RESOLVED
```

Guardrail scenarios can terminate or divert that path for ambiguous OPC
matches, missing/stale context, policy denial, self-approval, frozen-plan
drift, failed preflight, budget exhaustion, emergency halt, execution failure,
or failed verification.

## Control Tower architecture

The Control Tower is a Fastify server serving a single-page console on port
`4000`. It is an incident workspace with three operational views:

- Incident selection and status.
- Live lifecycle, current activity, evidence, proposed action, and approval.
- Trust-envelope inspection: OPC/version, context freshness, grounded claims,
  plan hash, policy result, delegated identity, connector mode, and ledger data.

The server streams incident snapshots and deltas with Server-Sent Events (SSE).
The UI and Slack share one race-safe decision registry: the first valid
approve/reject action wins, and later attempts report the recorded decision.
Demo playback pacing is server-controlled between 150 and 3,000 milliseconds
per presented step.

Key endpoints include:

| Endpoint                               | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| `GET /`                                | Control Tower application.                         |
| `GET /healthz`                         | Server and Slack enablement health.                |
| `GET /api/stream`                      | Initial incident snapshot and live SSE updates.    |
| `POST /api/trigger`                    | Start a configured demo scenario.                  |
| `POST /api/incidents/:id/decision`     | Approve or reject from the console.                |
| `GET/POST /api/playback`               | Read or adjust demo step pacing.                   |
| `GET/POST/PUT /api/onboarding/apps...` | Manage local application onboarding configuration. |
| `GET /api/customer-domain`             | Profile/wallet demo dependency health.             |
| `GET /api/listener`                    | Slack event and callback readiness.                |
| `POST /slack/events`                   | Receive verified Slack Events API callbacks.       |
| `POST /slack/interactions`             | Receive verified Slack approval actions.           |

## Slack integration

Slack is both an incident source and an approval surface; it is not the
approval system of record. The Control Tower verifies Slack signatures over
the exact raw request body and maps Slack users to platform principals.

Local callbacks require a public HTTPS endpoint because Slack cannot call
`localhost`. `run-demo.sh ui` can open an ngrok tunnel and exposes:

```text
POST /slack/events
POST /slack/interactions
```

Required local secrets are loaded from the git-ignored `.env.local` file:

```text
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
SLACK_CHANNEL
SLACK_USER_MAP        # optional mapping to platform principals
```

The proposer cannot approve their own R2 action. Approval requires an eligible
principal and is accepted once across Slack and the Control Tower.

## Application onboarding model

Onboarding is configuration, not runtime branching. An onboarded application
captures:

- Application identity, ownership, environment, and criticality.
- Services and downstream topology.
- Read-only evidence/context access.
- Registered write/action access.
- Triggers and their routing criteria.
- SOPs/OPCs, allowed actions, checks, escalation, and verification.
- Approval roles and operational boundaries.

The local Control Tower persists this configuration to
`.local/onboarding.json`, which is intentionally git-ignored. Production
storage must preserve tenant isolation, validation, version binding, and
activation semantics through the platform data model.

## Customer profile and wallet demo topology

The local domain demo runs two Fastify services:

```text
Wallet :4102 ──500 ms dependency timeout──► Customer Profile :4101
                                                  │
                                                  ├── profile records
                                                  └── embedded TTL cache
```

The primary fault scenario disables cache use and single-flight coalescing,
then raises profile database latency from 45 ms to approximately 1,400 ms. A
12-request wallet burst times out on the profile dependency, reproducing a
downstream authorization cascade. Remediation restores database latency,
re-enables 60-second cache-aside behavior, pre-warms the affected profile, and
enables single-flight miss coalescing before verification repeats the burst.

The demo cache is `EmbeddedTtlCache`, an in-process, zero-install TTL key/value
store exposing the small asynchronous interface the scenario needs. It is
appropriate for a deterministic local demo but is not durable, distributed, or
production-ready. The production architecture uses Redis where shared cache or
BullMQ orchestration is required.

## Data and evidence architecture

PostgreSQL is the relational system of record and Prisma owns the schema and
migrations. Evidence is append-only; corrections create new records referencing
superseded evidence rather than mutating history. The transactional outbox
supports reliable event publication and deduplicating consumers.

All repository access includes `tenant_id`, including single-tenant local
deployments. Read models reconstruct execution history, engineering context,
and version bindings for the Control Tower without granting the UI mutation
authority over the ledger.

## Security and authorization boundaries

1. Read connectors and action connectors are structurally separate.
2. Agents receive bounded context but never resolved secret values.
3. Proposed actions must match the frozen plan and a registered action.
4. Deterministic policy decides deny, approval-required, or auto-authorized.
5. Human approval is bound to an accountable identity and role.
6. Preflight checks detect drift immediately before execution.
7. Connectors receive scoped execution authorization, not ambient agent access.
8. Verification and evidence recording are mandatory after execution.
9. Authorized operators retain emergency halt and rollback controls.

The only permitted mutation path is:

```text
ProposedAction → PolicyEngine → ApprovalGate → ActionExecutor →
VerificationEngine → EvidenceLedger
```

## Technology baseline

- Node.js 20 or newer and TypeScript in strict ESM mode.
- pnpm workspaces.
- Fastify for HTTP services.
- Zod contracts for runtime validation.
- PostgreSQL with Prisma for durable relational state.
- Redis and BullMQ for production durable orchestration.
- Vitest for unit and integration tests.
- ESLint and Prettier for static and formatting checks.
- Provider interface for investigator/planner LLM calls.

The current demo uses a deterministic simulated LLM provider and simulated
action connector so outcomes and guardrails remain reproducible. Replacing
them with a real provider or production action connector must not weaken the
same contracts, policy path, approval rules, or evidence requirements.

## Local development topology

From the nested repository root:

```bash
pnpm install
./run-demo.sh ui
```

Common local endpoints:

| Service                           | Address                 |
| --------------------------------- | ----------------------- |
| Control Tower                     | `http://localhost:4000` |
| Customer Profile                  | `http://127.0.0.1:4101` |
| Wallet                            | `http://127.0.0.1:4102` |
| ngrok inspection UI, when running | `http://127.0.0.1:4040` |

`run-demo.sh ui` is idempotent: if a healthy Control Tower already owns port
`4000`, the launcher reuses it instead of starting a duplicate. Direct
`pnpm ui` also exits cleanly when an existing instance owns the port.

Quality commands:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format
```

Integration tests that require external infrastructure are enabled separately
with `pnpm test:integration`.

## Production substitutions and open boundaries

The local experience proves control flow and governance; it does not claim the
following demo implementations are production infrastructure:

| Demo implementation                   | Production boundary                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| In-process incident/onboarding stores | Tenant-scoped durable persistence.                                           |
| Embedded TTL cache                    | Redis or an approved managed cache.                                          |
| Simulated LLM provider                | Approved provider adapter with budgets, redaction, and observability.        |
| Simulated action connector            | Registered least-privilege connector to the target system.                   |
| Local identity resolver               | Enterprise IdP and accountable delegated identity.                           |
| ngrok callback tunnel                 | Stable ingress with TLS, authentication controls, and operational ownership. |

Deployment platform, tenant observability stack, ITSM system, enterprise IdP,
secret manager, compliance regime, retention policy, and the first production
action connector remain tenant-specific decisions tracked in
`system-inventory.md` and `technical-constraints.md`.

## Source hierarchy

When engineering sources disagree, use this order:

1. Accepted requirements and ADRs under `requirements/` and `pipeline/adr/`.
2. `CONTEXT.md` for standing Build-loop engineering rules.
3. Zod contracts and executable tests for implemented behavior.
4. This document for orientation and technical communication.
5. Demo or presentation copy.

Update this Engineering Context whenever a component boundary, local topology,
security invariant, or production/demo substitution materially changes.
