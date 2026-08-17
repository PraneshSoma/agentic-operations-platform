# Project Context — Agentic Operations Platform

The standing brief every loop agent (planning, codegen, testgen, review, ...)
inherits automatically. Keep this file specific — vague rules produce vague
code. Source of truth for the domain is
`requirements/AOP-001-agentic-operations-platform.md`; this file is the
engineering brief derived from it.

---

## What this service does

A governed operational runtime. Tenants configure triggers (Slack, webhook,
later ServiceNow/PagerDuty), Operational Procedure Contracts (OPCs — the
declarative object describing required evidence, mandatory checks, permitted
actions, verification, escalation, and budget for one class of operational
work), context connectors (read-only), actions (write, registered), and policy.
At runtime: a trigger normalizes into an `IncomingRequest`, gets matched to an
OPC, and a durable orchestrator runs it through context assembly →
investigation → diagnosis → planning → policy evaluation → (human approval if
required) → action execution → verification → evidence recording. The LLM
proposes; the runtime authorizes. No tenant- or scenario-specific logic is ever
embedded in the runtime — everything is config.

Node.js 20 / TypeScript (strict) / PostgreSQL / Redis. Monorepo, pnpm
workspaces.

---

## Stack

- **Language:** TypeScript 5.x, `strict: true`, ESM (`"type": "module"`), no `any`
  without a `// justified:` comment.
- **API framework:** Fastify 4, JSON Schema request/response validation via
  `@fastify/type-provider-zod`.
- **Persistence:** PostgreSQL via Prisma (schema-first migrations). The
  relational core is the system of record (spec §32) — vector search, if added
  later, is for historical-evidence retrieval only, never the system of record.
- **Queue / durable orchestration:** BullMQ on Redis for state-machine step
  execution, retries, and timeouts (spec §7). The orchestrator is our own
  persisted state machine — do **not** introduce a dependency on LangGraph or
  Temporal; the spec is explicit that the LLD must not depend on any specific
  orchestration framework.
- **Validation:** Zod for every domain contract (OPC, ActionDefinition,
  ProposedAction, ...) and for connector `input_schema`/`output_schema`.
  Contracts in `packages/contracts` are the single source of truth — connectors
  and the orchestrator both import from there, never redeclare a shape.
- **LLM provider:** Anthropic Claude (Messages API) for the Investigator and
  Planner agents, behind a provider interface (`packages/contracts` defines the
  interface; a concrete `@anthropic-ai/sdk` adapter implements it) so a second
  provider can be added without touching call sites.
- **Secrets:** never inline, never in agent context (spec §24). A
  `SecretResolver` interface with a local-dev env-var-backed implementation and
  a pluggable cloud secret-manager implementation (AWS Secrets Manager to
  start). Connectors receive a `secret_ref`, resolve it themselves, and the LLM
  never sees the resolved value.
- **Testing:** Vitest. `@testcontainers/postgresql` for repository/integration
  tests against a real Postgres, not a mock.
- **Lint/format:** ESLint (flat config) + Prettier, enforced in CI.
- **Package manager:** pnpm, workspaces (`packages/*`, `apps/*`).

---

## Package layout

```
packages/contracts/         Zod schemas + inferred TS types for every domain
                             contract (§4): IncomingRequest, OperationalProcedureContract,
                             ProposedAction, PolicyDecision, ExecutionResult, Evidence,
                             ExecutionState, ContextPackage, ActionDefinition,
                             ExecutionAuthorization, PreflightResult, etc.
                             No logic here beyond schema + type — every other
                             package imports from this one; this one imports from none.

packages/context-service/   ContextConnector interface + registry (§10), Context
                             Package assembly (§8-9), staleness enforcement.
                             src/connectors/, src/assembly/

packages/policy-engine/     Deterministic PolicyRule evaluation (§15-16),
                             risk classification, OPC-match margin guardrail (§6A).
                             src/rules/, src/risk/, src/matching/

packages/action-executor/   ActionConnector interface + registry (§13-14),
                             preflight/drift check (§14B), execution identity
                             delegation (§14A), rollback (§20).
                             src/connectors/, src/executor.ts, src/preflight.ts

packages/evidence-ledger/   Prisma schema (§32 relational core) + append-only
                             evidence/state-transition writes (§21).
                             prisma/schema.prisma, src/repositories/

apps/api/                   Fastify app: trigger webhook endpoints, approval
                             callback endpoints, halt/kill-switch endpoints (§7A),
                             read-only Control Tower API (§27).
                             src/routes/, src/plugins/

apps/worker/                Durable orchestrator (§7): consumes BullMQ jobs,
                             drives ExecutionState transitions, invokes
                             Investigator/Planner agents, enforces token/cost
                             budget (§7B).
                             src/orchestrator/, src/agents/

apps/dashboard/              Control Tower SPA (§27-28), read-only against the
                             evidence ledger via apps/api.
                             src/views/

infra/                      docker-compose.yml (Postgres, Redis) for local dev.
```

`style_reference` for the Planning Agent (loop/agents/planning.md) is
`packages/contracts/src/schemas/evidence.ts` once it exists — a Zod schema +
inferred type pair, JSDoc'd, one export per contract, no class hierarchies.
Until the first story lands it, new schema files should follow this shape:
`export const XSchema = z.object({...}); export type X = z.infer<typeof XSchema>;`

---

## Coding rules — non-negotiable

**RULE 1: Every domain contract is a Zod schema in `packages/contracts`, never
a hand-written `interface` duplicated elsewhere.**
```ts
CORRECT:  export const ProposedActionSchema = z.object({ proposal_id: z.string(), ... });
          export type ProposedAction = z.infer<typeof ProposedActionSchema>;
WRONG:    interface ProposedAction { proposal_id: string; ... }   // no runtime validation
```
Runtime input (connector results, LLM output, webhook payloads) MUST be parsed
through the schema (`Schema.parse(...)`) at the boundary — never cast with `as`.

**RULE 2: Money and quantity fields, if any connector/action ever introduces
them, are `Decimal` (via `decimal.js` or Prisma's `Decimal`), never `number`.**
```ts
CORRECT:  const cost: Decimal = new Decimal(row.wholesale_cost);
WRONG:    const cost: number = row.wholesale_cost;   // silent float precision loss
```

**RULE 3: Read connectors and write (action) connectors are separate
interfaces, in separate packages, and a single class must never implement
both.** This is spec §1.3/§10's read/write separation invariant — it is not
optional and not a style preference.
```ts
CORRECT:  class ServiceNowReadConnector implements ContextConnector { ... }
          class ServiceNowActionConnector implements ActionConnector { ... }
WRONG:    class ServiceNowConnector implements ContextConnector, ActionConnector { ... }
```

**RULE 4: Every storage access includes `tenant_id`.** No repository method may
accept an entity ID without also taking `tenant_id`, and no Prisma query may
omit a `tenant_id` filter — this is spec §23's required invariant, and a
missing filter is a cross-tenant data leak, not a style issue.
```ts
CORRECT:  prisma.evidence.findMany({ where: { tenant_id, execution_id } })
WRONG:    prisma.evidence.findMany({ where: { execution_id } })   // leaks across tenants
```

**RULE 5: Secrets never enter agent/LLM context.** Connectors resolve
`secret_ref` themselves via `SecretResolver`; the value never flows into a
prompt, a log line, or `structured_data` on an `Evidence` record.
```ts
CORRECT:  const token = await secrets.resolve(connector.authorization.secret_ref);
          // token used directly in the outbound HTTP call, never returned
WRONG:    const token = await secrets.resolve(ref); return { ...context, token };
```

**RULE 6: Mutations only ever happen through
`ProposedAction -> PolicyEngine -> ApprovalGate -> ActionExecutor -> Verification -> EvidenceLedger`
(spec §1.2).** No agent-facing code path may call an `ActionConnector.execute()`
directly; it is only ever invoked by the executor with a signed
`ExecutionAuthorization`.
```ts
CORRECT:  await actionExecutor.execute(action, params, authorization)  // from apps/worker only
WRONG:    await connector.execute(action, params, someAdHocAuth)       // bypasses policy/approval
```

**RULE 7: Every state transition of `ExecutionState` persists, emits a
`PlatformEvent`, and writes an `Evidence` record — all three, every time
(spec §7).** A transition that only updates in-memory state or only persists
without emitting is incomplete.

**RULE 8: All new connectors/actions are additive and disabled by default in a
tenant's config until explicitly registered** — there is no "global" connector
or action; everything is resolved through `tenant_id` + a registry lookup.

---

## Style reference

None yet — this repo is pre-Phase-3. Once the first `packages/contracts` schema
file lands (via the Build loop), it becomes the style reference for all
subsequent schema files, and this section should be updated to point at it by
path, per the upstream framework's convention.
