# Agentic Operations Platform

A governed operational runtime: organizations configure triggers, Operational
Procedure Contracts (OPCs), context connectors, actions, and policy; agents
investigate and plan against bounded, evidence-backed context; a deterministic
policy engine controls authority; humans gate higher-risk work; every decision
and outcome is recorded to an evidence ledger.

This is not a chatbot bolted onto operational tooling. The runtime never learns
what "ServiceNow", "hierarchy mismatch", or any other tenant-specific term means
— it only knows OPCs, connectors, actions, and policy, all config-driven. See
`requirements/AOP-001-agentic-operations-platform.md` for the full implementation
specification this initiative is built from.

**Status:** scaffolded, not yet built. Phase 1 (Discovery) has not run yet — see
[Running the loop](#running-the-loop) below.

---

## Architecture, in one paragraph

An external trigger (Slack, webhook, later ServiceNow/PagerDuty) normalizes into
an `IncomingRequest`. The Request Router matches it to a config-owned OPC — the
declarative contract describing what evidence is required, what checks are
mandatory, what actions are allowed, and when escalation is mandatory — with a
deterministic-margin guardrail against ambiguous matches. A durable orchestrator
runs the request through context assembly, investigation, diagnosis, and
planning; every mutating step is a `ProposedAction` that must clear the
deterministic Policy Engine and, above R0/R1 risk, a human Approval Gate, before
the Action Executor runs it (with a pre-execution drift check) and the
Verification Engine confirms the outcome. Every step — context, hypothesis, plan,
approval, execution, verification — is written to an append-only Evidence Ledger
that the Control Tower dashboards read from. Full detail in the spec.

---

## Built using the agentic-sdlc-loop framework

This repo is built with [agentic-sdlc-loop](https://github.com/PraneshSoma/agentic-sdlc-loop):
a config-driven, 4-phase pipeline of AI agents (Discovery → Design → Build →
Validate) with human approval gates between every stage. The framework itself
lives under `loop/` — agent bodies, config, and the mode generator — already
adapted for this product (see `CONTEXT.md` and the Fill-the-Placeholders
checklist below). Nothing here is scenario-specific to the loop framework
itself; this repo is a *consumer* of it, the same way `example/` is in the
upstream repo.

| Path | What it is |
|---|---|
| `README.md` | this file |
| `CONTEXT.md` | the standing brief every loop agent reads — domain, stack, coding rules |
| `requirements/AOP-001-*.md` | the Phase 1 Discovery input — the full implementation spec |
| `loop/agents/` | 12 agent bodies + supervisor, filled in for this product's domain |
| `loop/config/loop.config.json` | model tiers, budgets, guardrails, test/lint commands |
| `loop/tools/generate.mjs` | generates Copilot and Claude Code modes from source |
| `loop/modes/` | generated output — do not edit directly, regenerate instead |
| `docs/HOW-IT-WORKS.md` | the 4-phase fleet and inner loop, explained |
| `docs/GUARDRAILS.md` | budgets, self-heal, the real test gate — the safety story |
| `packages/`, `apps/` | the product's own workspaces — empty scaffolding until Phase 3 builds into them |

---

## Repo layout (target)

```
packages/contracts/        shared TS types + zod schemas for every domain contract
                            (IncomingRequest, OPC, ProposedAction, PolicyDecision,
                            ExecutionResult, Evidence, ...) — §4 of the spec
packages/context-service/  context connectors + Context Package assembly       — §8-10
packages/policy-engine/    deterministic policy evaluation                     — §15-16
packages/action-executor/  action registry, connectors, preflight, execution   — §13-14
packages/evidence-ledger/  Prisma schema + append-only evidence/state storage  — §21, §32
apps/api/                  Fastify HTTP API — triggers, approvals, control tower reads
apps/worker/               durable orchestrator loop (state machine)           — §7
apps/dashboard/            Control Tower — React/Vite SPA                      — §27-28
infra/                     docker-compose (Postgres, Redis) for local dev
```

Only the workspace tooling and package skeletons exist today — the loop's Build
phase (Phase 3) is what actually fills these in, story by story, once Phase 1/2
have run and produced a story queue.

---

## Stack

Node.js 20 (TypeScript, strict) · Fastify · PostgreSQL via Prisma · Redis +
BullMQ for the durable orchestrator · Zod for contract/schema validation ·
Vitest for tests · ESLint + Prettier · pnpm workspaces · Anthropic Claude for
the Investigator/Planner agents (provider-pluggable — see `CONTEXT.md`).

Rationale: the spec's contracts are already written as TypeScript interfaces
(§4) with a relational persistence model (§32) and YAML-shaped config objects —
TS + Postgres is the most direct implementation of what's already on the page.
See `CONTEXT.md` for the full brief.

---

## Running the loop

The framework is already installed and filled in for this product. What hasn't
happened yet is actually running it — that's a deliberate stop point so you can
review before any pipeline stage executes.

```bash
# 1. Regenerate modes if you change anything in loop/agents or loop/config
node loop/tools/generate.mjs

# 2. Point your surface at the generated mode
#    Claude Code: point it at loop/modes/agnostic/
#    Copilot:     cp -r loop/modes/copilot/.github/ .github/

# 3. Run Phase 1 against the seeded requirement doc
/run-pipeline req=AOP-001

# Single story once the queue exists:
/run-pipeline req=AOP-001 story=A-01

# Resume after an interruption:
/run-pipeline resume
```

During the loop, the supervisor pauses at every HIL gate — `APPROVE` /
`REVISE <feedback>` / `SKIP` / `PAUSE` / `HALT` / `STATUS`. State persists in
`pipeline_state.json` after every gate. See `docs/HOW-IT-WORKS.md` and
`docs/GUARDRAILS.md` for the full mechanics, and the upstream repo's
`GETTING-STARTED.md` if you want the from-scratch walkthrough.

### What Phase 1/2 will produce here

This repo intentionally does **not** pre-author ADRs, an LLD, or a story queue.
`requirements/AOP-001-agentic-operations-platform.md` is deliberately the raw
Phase-1 input — the full implementation spec — so Discovery → Requirements →
ADR → LLD → Story Gen run for real against it rather than being hand-written.
`loop/agents/supervisor.md`'s story queue currently holds an *illustrative*
placeholder seeded from the spec's own §38 suggested sequence — replace it with
Story Gen's real output once Phase 2 completes.
