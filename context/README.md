# Composite Context — Product Intent + Engineering Context

`composite-context.json` is the machine-readable routing manifest used by the
agent loop. Before every handoff, the Supervisor runs
`loop/tools/build-context-packet.mjs` to resolve a small, content-hashed packet
for that stage and story under the git-ignored `pipeline/.context/` cache. This
lets later loops reuse current engineering knowledge without rescanning the
whole repository or carrying the accumulated conversation.

Generate or inspect packets manually with:

```bash
pnpm context:packet -- --stage discovery
pnpm context:packet -- --stage planning --story A-01
pnpm context:packet -- --stage codegen --story A-01 --stdout
```

Packets contain pointers and content hashes, not copied source bodies. The
hash-derived cache key makes unchanged context reusable; a changed source
invalidates the packet deterministically. Stage routes live only in
`composite-context.json`, so adding or removing a context source does not
require editing every agent prompt.

Two context categories that drive Phase 1 (Discovery), separate from
`requirements/AOP-001-agentic-operations-platform.md` (the implementation
spec — architecture-shaped) and `CONTEXT.md` (the Build-loop's engineering
brief — codegen-shaped). This folder is business/operational-shaped: it's
what a human would tell a new hire before handing them the spec.

```
context/
  product-intent/
    business-ask.md              →  Discovery input: business_ask
    stakeholders.md               →  Discovery input: stakeholder_docs
    vision-and-differentiation.md →  Discovery input: business_ask (the "why it matters" layer)
    product-context.md            →  Presentation-ready positioning, demo narrative, and messaging
  engineering-context/
    engineering-context.md       →  Implemented architecture, runtime, demo topology, and boundaries
    system-inventory.md          →  Discovery input: system_inventory
                                     also: ADR input: architecture_context
    technical-constraints.md     →  ADR input: architecture_context (constraints half)
```

**Start with `product-intent/vision-and-differentiation.md`.** It's the
product owner's own framing of what makes this platform worth building
("evidence-driven engineering control plane," not "agents automate KTLO") and
it explicitly reconciles itself against the v0.2 spec — including one real
open scope question (does a code/config-change-and-PR resolution path belong
in v1, reusing the agentic-sdlc-loop's own Build loop as a governed action
type) that Requirements/ADR should resolve deliberately, not by default.

`loop/agents/discovery.md` and `loop/agents/adr.md` read these files by path —
see their Inputs sections. Do not restate the implementation spec here; link
to the section number instead (`per §14A`) the way `loop/agents/requirements.md`
already does. This folder's job is the *why* and the *what already exists*;
the spec is the *how*.

## Why two categories, not one

Discovery's job (per `docs/HOW-IT-WORKS.md`) is to map "a business ask,
stakeholder docs, existing system inventory" into a discovery brief before any
design happens. Product Intent and Engineering Context are genuinely
different kinds of unknowns, and conflating them tends to produce a discovery
brief that's vague on both:

- **Product Intent** — why this is being built, for whom, what "solved"
  means. Owned by product/business stakeholders. Changes rarely once set.
- **Engineering Context** — what already exists at Tenant #1 that the
  platform has to integrate with or operate inside of (ticketing/paging
  tools, cloud platform, secrets/auth infra, compliance regime). Owned by
  engineering/platform stakeholders. This is *not* the spec's own deferred
  "Engineering Context" phase (§36 — source-code/ADR correlation as a runtime
  capability); it's the same term meaning something narrower and more
  mundane here: what's already running that Discovery needs to know about.

## What's filled in vs. what's an open item

Every file below is populated with what's legitimately derivable from the
implementation spec and this initiative's own framing — not invented. Where
the real answer is tenant-specific and unknown to this repo (an actual
existing ticketing system, a named platform owner, a compliance regime),
it's flagged `OI-CTX-##` inline, the same numbering convention
`loop/agents/discovery.md` and `requirements.md` already use for open items.
Discovery should carry these into its own `open_questions` rather than
silently assuming an answer.

For executive briefings, demos, and source-grounded deck generation, use
`product-intent/product-context.md`. It packages the approved product narrative,
elevator pitch, lifecycle, proof scenario, governance principles, and visual
guidance without replacing the implementation or engineering sources of truth.

For contributor onboarding, technical reviews, and architecture presentations,
use `engineering-context/engineering-context.md`. It summarizes the implemented
workspace, runtime flow, Control Tower and Slack wiring, profile/wallet demo,
security boundaries, local topology, and the substitutions still required for
production.
