# Technical Constraints

> Feeds ADR's `architecture_context` input (`loop/agents/adr.md`), the
> constraints half — as distinct from `system-inventory.md`'s inventory half.

## Constraints the spec already imposes (non-negotiable, not this tenant's choice)

These come from the implementation spec directly and should be treated by
Discovery/ADR as fixed, not open for re-litigation per initiative:

- **No LangGraph/Temporal dependency in the LLD** — the durable orchestrator
  must be implementable framework-agnostically (§7). `CONTEXT.md` already
  encodes this as a rule.
- **Read/write connector separation is structural, not a convention** — a
  single class must never implement both interfaces (§1.3, §10).
- **Secrets never enter agent/LLM context** — no exceptions, no "just for
  debugging" (§24).
- **The policy engine must be deterministic** — no LLM call, no wall-clock
  read, nothing non-reproducible inside a `PolicyDecision` evaluation (§16).
- **Evidence is append-only** — corrections are new records referencing the
  superseded one, never in-place mutation (§21).
- **Every storage access includes `tenant_id`**, even for the
  single-tenant-per-deployment MVP posture (§23) — the multi-tenant-safe data
  model is not deferred, only the SaaS deployment topology is.

## Constraints this repo has already decided (see `CONTEXT.md`)

Node.js 20/TypeScript strict, Fastify, PostgreSQL via Prisma, Redis+BullMQ,
Zod, Vitest, pnpm workspaces, Anthropic Claude behind a provider interface.
Discovery/ADR should treat these as settled inputs, not re-derive them —
if an ADR wants to revisit one, it should say so explicitly rather than
silently assuming a different stack.

## Constraints not yet known (tenant/deployment specific)

Unlike the spec-level constraints above, these depend on where and how this
platform actually gets deployed and are currently unset.

## Open items

- **OI-CTX-09**: Target deployment environment — cloud provider, Kubernetes
  vs. simpler container hosting, existing CI/CD tooling this has to plug
  into. `infra/docker-compose.yml` only covers local dev.
- **OI-CTX-10**: Compliance/regulatory regime in scope (SOC 2, HIPAA, PCI,
  none yet) — affects audit-log retention requirements beyond the spec's own
  "append-only, hash-chained" baseline (§21, §22) and `retention_class` on
  `Evidence` (§4.6).
- **OI-CTX-11**: Data residency constraints, if any — relevant once a second
  tenant/region is in play (spec §38 Iteration 6), not blocking for MVP.
- **OI-CTX-12**: Existing identity provider (Okta, Azure AD, ...) for human
  approvers/requesters — relevant to `ExecutionAuthorization.identity` (§14A)
  resolving to a *real* accountable identity, not just a string ID.
