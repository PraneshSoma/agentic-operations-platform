# Vision & Differentiation — the ECP framing

> Strategic input from the product owner, captured verbatim in substance
> (2026-08-17), not derived from the implementation spec. This is a *product
> intent* document — Discovery reads it as part of `business_ask`/
> `stakeholder_docs`; it is not itself an architecture decision. Where it
> extends or tensions with `requirements/AOP-001-agentic-operations-platform.md`
> (the v0.2 spec), that's called out explicitly below rather than silently
> resolved — Discovery/Requirements should carry the tension forward as an
> open item, not this file deciding it unilaterally.

## The differentiation thesis

Agent frameworks that plan and execute are becoming commoditized. The
differentiator is not "AI agents automate work" — it's **the control system
around the agents**: an evidence-driven engineering control plane (ECP) that
takes operational work from intake → context → execution → verification →
governed closure. Multiple agent frameworks will exist; not many control
planes will be trustworthy enough for an enterprise to let one execute
against production.

## The full-loop architecture

```
Work Intake            ServiceNow / Slack / alerts / Jira / manual request
     ↓
Work Normalization     What happened? What system? Severity? Desired outcome?
     ↓
Composite Engineering  Product ask + product context + engineering standards +
Context                repo/code evidence + runtime evidence + historical decisions
     ↓
Supervisor / Planner   Classifies the work, creates an execution plan
     ↓
Specialist Agents      Diagnosis → code/config change → tests → documentation → PR
     ↓
Evidence & Evaluation  Tests, static analysis, policy checks, runtime evidence,
Layer                  cross-model review
     ↓
Confidence Engine      "How much evidence supports this change?"
     ↓
Policy / Approval Gate Auto-approve / engineer review / architect review / reject
     ↓
Execution              PR / deployment / operational action
     ↓
Post-change            Did the change actually solve the original problem?
Verification
     ↓
Audit + Learning
```

The last two stages are what most agentic-SDLC demos skip — they stop at "the
agent generated a PR." This platform is only credible if it closes the loop:
**ticket → evidence → change → evidence → outcome.**

### Mapping onto the existing v0.2 spec

Every stage above already has a home in the spec or in `context/` — this is a
naming/emphasis layer over existing design, with one real scope question
(flagged below), not a rewrite:

| ECP stage | Spec / context anchor |
|---|---|
| Work Intake | §5 Trigger Layer (`TriggerSource`, `TriggerConfig`) |
| Work Normalization | §4.1 `IncomingRequest` |
| Composite Engineering Context | §8-9 `ContextPackage` + this `context/` tree — see "Engineering Context Package" below |
| Supervisor / Planner | §6 Request Router + OPC Matcher, §11 Investigator, §12 Planner |
| Specialist Agents | §13-14 Action Registry / Action Executor — **plus a scope question**, see below |
| Evidence & Evaluation Layer | §19 Verification Engine, §21 Evidence Ledger — cross-model review is **new**, not yet in the spec |
| Confidence Engine | §26 Confidence Model — **reconcile carefully**, see below |
| Policy / Approval Gate | §16 Policy Engine, §18 Approval Service |
| Execution | §14 Action Executor, §14A Execution Identity & Delegation |
| Post-change Verification | §19 Verification Engine (`recommended_next_step`) |
| Audit + Learning | §21 Evidence Ledger, §17 Autonomy Graduation Policy |

## Engineering Context Package — elevate to a first-class primitive

Composite Context (this `context/` tree) should not stay a Discovery-only
input. The same shape should back every work item at runtime:

```
Intent + System Context + Engineering Constraints + Evidence +
Execution History + Evaluation Results
```

Every agent in the loop operates against the **same governed package**,
rather than each agent independently deciding what context to go fetch. This
is materially the same discipline `ContextPackage` (§9) already enforces —
immutable once supplied, bounded, provenance-tracked, staleness-marked — with
`Execution History` and `Evaluation Results` as two fields the current
`ContextPackage` schema doesn't yet carry (today that's split across
`HistoricalEvidenceContext` and `VerificationResult`, not one package).
**Reconciliation note for LLD:** consider whether `ContextPackage` should gain
these as explicit sub-objects, or whether keeping them as separate contracts
joined by `execution_id` (current design) already satisfies this without a
schema change — this is an LLD-stage decision, not a Discovery-stage one.

The same discipline is the direct justification for context isolation
(`guardrails.context_isolation` in `loop/config/loop.config.json`) and for
`ContextPackage.missing_context`/`provenance` (§9): the supervisor
constructs the *minimum sufficient* context per agent call rather than
broadcasting everything to everyone — this is already built, not aspirational.

## Scope question: does "Specialist Agents" include code/config changes?

The v0.2 spec's Action Registry (§13-14) is written around **operational**
actions against registered systems (restart, scale, reconcile, flip a flag) —
not code changes with tests and a PR. This vision explicitly includes
"diagnosis → code/config change → tests → documentation → PR" as a resolution
path (the worked example is a Checkout-service timeout fixed by a code
change, not an ops action).

That path already exists — **it's this repo's own Build loop** (`planning →
codegen → testgen → rfc`, `docs/HOW-IT-WORKS.md`). The natural reconciliation
is: a code/config-change resolution is a new `ActionDefinition` kind whose
`executor_connector_ref` invokes the Build loop's inner loop (planning →
codegen → testgen → rfc) as a governed action, frozen-plan and
policy-gated exactly like any other `ProposedAction` (§1.2, §12). It becomes
one more registered action type, not a parallel system — the runtime still
doesn't know "code fix" is special, the same way it doesn't know
"hierarchy_mismatch" is special (§1.1).

**This is a real scope decision, not a foregone one — Requirements/ADR
should decide it explicitly, with at least one alternative considered (e.g.
code changes stay entirely out of v1 scope, or become a completely separate
action-executor implementation instead of reusing the Build loop) rather
than this file deciding it by default.**

## Confidence Engine — reconcile against §26, don't replace it

The spec is deliberate that a bare `confidence: 0.87` is not authority for
anything (§1.4, §17 "Design principle", §26). The mockup below is *not* a bare
score — it's a composite built from itemized, named evidence, which is
exactly what §26's `ReasoningAssessment` already models:

```
Confidence 92%
Unit tests ✓
Integration tests ✓
Architecture policy ✓
Security policy ✓
Independent review ✓
Production evidence ✓
Blast radius: Medium
Human approval: Required
```

Reconciliation: the Confidence Engine's UI output can and should look like
this — a Governance/Operations dashboard concern (§27-28) — but the number
itself must satisfy §26's existing constraint: "if a numeric score is later
introduced, it must be empirically calibrated against historical outcomes,"
never model self-reported. The itemized checklist above *is* the
`ReasoningAssessment`/`VerificationResult` evidence already specified — the
"92%" is a display rollup of that evidence, computed deterministically (like
the Policy Engine, §16), not asked of the LLM. "Independent review" (a second
model reviewing the first's output) is a genuinely new evaluation input not
yet named in the spec — closest existing hook is Review Agent-style auditing
(`loop/agents/review.md`) applied per-change rather than per-PR-batch.

## Prototype focus — one KTLO story end-to-end, not many tools

Don't build ten impressive-looking tools simultaneously. Build **one**
keep-the-lights-on (KTLO) story end-to-end and make the screen above real.
Illustrative shape (not yet a real Tenant #1 ticket — see `OI-CTX-01` in
`business-ask.md`):

> Production support ticket: "Checkout service is seeing elevated timeout
> failures." ECP receives the ticket, gathers logs, relevant source,
> ownership, recent commits, architecture/runbook context. The
> supervisor determines likely causes. A diagnostic agent investigates. A
> coding agent proposes a fix. Tests execute. Another model reviews it
> independently. ECP calculates confidence, and the four-line summary above
> is what a human sees before approving.

The four architectural ideas the prototype has to actually demonstrate — the
dashboard, ServiceNow integration, Slack approvals, and multi-model routing
are implementation details once these are real:

1. **Context is engineered, not dumped into prompts.** (Composite Context /
   `ContextPackage`, §8-9 — already the design; the discipline is the point.)
2. **Agents propose actions; policy governs authority.** (§1.2, §16 — already
   the design.)
3. **Confidence comes from evidence, not model self-confidence.** (§26 — already
   the design; see reconciliation above.)
4. **The loop isn't complete until the production outcome is verified.** (§19
   — already the design; "verification success ≠ execution success.")

None of these four require new engineering beyond what §1-40 already specify
— what they require is that Iteration 1-5 (spec §38) actually get built in a
way that proves all four end-to-end on one story, rather than each iteration
landing in isolation. **This should directly inform Story Gen's sequencing**:
prefer depth on one path (through to Confidence Engine + Policy Gate +
Verification, even if narrow) over breadth across many OPCs, for the first
real pass through Phase 3.

## Portfolio narrative (context only — not a scope decision)

> Agentic Commerce demonstrates what agents can do. Agentic SDLC Loop
> demonstrates how agents can build. ECP demonstrates how an enterprise can
> trust and operate them.

Noted for framing; **does not by itself decide** whether this repo/product
renames from "Agentic Operations Platform" to "ECP" — that's a naming
question with real repo-wide surface area (README, CONTEXT.md, package
scope `@aop/*`, `initiative: AOP-001`), left open rather than applied here.
