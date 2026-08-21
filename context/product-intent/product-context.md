# Product Context — Agentic Operations Platform

> Presentation-ready product narrative for internal alignment, executive
> briefings, demos, and source-grounded deck generation. This document explains
> the product in business language; it does not replace the implementation
> specification in `requirements/AOP-001-agentic-operations-platform.md` or the
> engineering rules in `CONTEXT.md`.

## Product in one sentence

The Agentic Operations Platform (AOP) turns production incidents into
evidence-driven, policy-governed remediation while keeping humans in control
of sensitive actions.

## Elevator pitch

Today, production incidents force engineers to manually connect alerts, logs,
dependencies, runbooks, and approval workflows while customers and revenue
remain at risk. AOP acts as an operational control plane: it detects an
incident, assembles evidence, identifies the likely root cause, selects the
appropriate operating procedure, and proposes a safe remediation. High-risk
production actions pause for human approval in Slack. After approval, AOP
executes the change, verifies customer recovery, and records exactly what
happened. The result is faster recovery, consistent operational execution, and
governed automation that teams can trust.

## Positioning

### The problem

Incident response is fragmented, manual, and slow. Operators must correlate
signals across tools, reconstruct system context, find the right procedure,
coordinate approvals, execute changes, and prove that customers recovered.
Traditional scripts automate isolated actions but do not provide the context,
governance, or closed-loop verification required for safe production use.

### The product

AOP is a configurable control plane above an organization's existing
applications, observability systems, collaboration tools, and operational
actions. Teams onboard applications by defining their services, topology,
triggers, evidence sources, Operational Procedure Contracts (OPCs), permitted
actions, access boundaries, approval policy, and recovery criteria.

### The outcome

Operators see one traceable path from incident detection to verified recovery:
what happened, what evidence supports the diagnosis, what action was proposed,
who authorized it, what changed, and whether the customer experience recovered.

## Primary audience

- CIOs, CTOs, and engineering executives evaluating operational resilience.
- SRE and operations leaders accountable for incident response and MTTR.
- Platform engineering teams that own shared operational capabilities.
- Security and compliance leaders responsible for production access and audit.
- Senior on-call engineers who diagnose, approve, halt, or oversee remediation.

## Product lifecycle

```text
DETECT → DIAGNOSE → PLAN → APPROVE → REMEDIATE → VERIFY
```

| Stage | What AOP does |
|---|---|
| Detect | Correlates service signals with customer impact and normalizes the incident. |
| Diagnose | Assembles bounded, provenance-tracked evidence and forms an evidence-grounded root cause. |
| Plan | Matches the incident to an OPC and freezes a permitted remediation plan. |
| Approve | Applies deterministic policy and pauses for an authorized human when required. |
| Remediate | Executes approved actions through registered, least-privilege connectors. |
| Verify | Confirms service and customer recovery, records the outcome, and recommends the next step. |

The detailed runtime state progression is:

```text
RECEIVED → OPC_MATCHED → CONTEXT → DIAGNOSED → PLANNED →
WAITING_APPROVAL → APPROVED → EXECUTING → VERIFYING → RESOLVED
```

## Core product capabilities

- Application onboarding with configurable service topology and ownership.
- Triggers from Slack, webhooks, telemetry, and future incident-management
  integrations.
- Reusable OPCs that define required evidence, checks, allowed actions,
  verification, escalation, and execution budgets.
- Evidence-grounded investigation that separates observations from inferences.
- Deterministic policy evaluation outside the language model.
- Slack-based approval for production actions with role requirements, evidence,
  expected impact, risk, and rollback context.
- Registered operational and engineering-change actions with explicit access
  boundaries.
- Control Tower visibility into every stage, current activity, supporting
  evidence, approval status, executed changes, and before/after health.
- Mandatory post-action verification and an append-only evidence ledger.

## Demonstration narrative — profile-to-wallet failure cascade

The primary demo reproduces a credible downstream failure caused by a slow
database response:

1. Profile database latency rises to approximately 1,400 ms.
2. A cache bypass exposes the slow database reads to live requests.
3. Wallet's 500 ms dependency timeout converts the latency into authorization
   failures.
4. AOP correlates profile latency, cache state, wallet dependency errors, and
   customer impact into one incident.
5. AOP matches the incident to `opc_profile_db_latency_cascade` and proposes a
   frozen remediation: restore database latency, re-enable cache-aside, pre-warm
   the hot profile, and enable single-flight cache-miss coalescing.
6. Because the remediation changes production cache behavior, policy requires a
   `senior_oncall` human approval in Slack.
7. After approval, AOP executes the registered action and verifies both profile
   latency and wallet success before closing the incident.

Proof-point summary:

> 1,400 ms profile DB latency → wallet authorization failures → governed cache
> and DB remediation → verified customer recovery.

## What makes AOP different

1. **Context is engineered, not dumped into prompts.** Evidence is bounded,
   provenance-tracked, freshness-aware, and shared through governed contracts.
2. **Agents propose; the runtime authorizes.** Models cannot grant themselves
   production authority or bypass policy, approval, and registered actions.
3. **Confidence comes from evidence.** Diagnostic claims are linked to observed
   signals rather than model self-confidence.
4. **The loop ends with customer recovery.** Successful execution is not
   treated as successful remediation until verification passes.
5. **The runtime is application-agnostic.** New applications, triggers, SOPs,
   access rules, and actions are configuration, not scenario-specific runtime
   code.

## Governance principles

- Autonomous where policy permits; human-controlled where risk requires it.
- Least-privilege access through registered connectors and delegated identity.
- Clear separation of recommendation, authorization, execution, and verification.
- No mutation outside the policy and approval path.
- Complete reconstruction of every decision and action from the evidence ledger.
- Rollback and halt controls remain available to authorized operators.

## Executive value narrative

AOP is designed to reduce time spent assembling incident context, improve the
consistency of diagnosis and remediation, shorten the path to customer
recovery, and make production automation governable. Quantified claims such as
MTTR reduction, engineering hours returned, or revenue protected must be backed
by measured tenant outcomes; they are not assumed product claims.

## Presentation guidance

### Recommended executive story

1. Production operations are fragmented and manual.
2. Isolated automation lacks context, authority controls, and verification.
3. AOP provides a governed incident-to-recovery control plane.
4. The profile-to-wallet cascade proves the loop end to end.
5. Application onboarding makes the model reusable across services.
6. Evidence, approval, least privilege, and verification make it enterprise-ready.

### Single-slide message

**Title:** From Production Incident to Verified Recovery

**Subtitle:** Evidence-driven diagnosis. Human-governed action. Closed-loop
remediation.

**Flow:** Detect → Diagnose → Plan → Approve → Remediate → Verify

**Problem:** Incident response is fragmented, manual, and slow.

**Outcome:** Faster, safer recovery with a complete record of what was fixed.

**Closing:** Autonomous where safe. Human-controlled where necessary.

### Visual direction

Use a premium light theme with warm ivory backgrounds, charcoal typography,
copper/orange accents, subtle grid lines, and restrained green for verified
recovery. Prefer architecture flows, lifecycle diagrams, evidence cards,
timelines, metrics, and realistic Control Tower or Slack examples. Avoid
generic robot, brain, or futuristic AI imagery.

## Messaging guardrails

- Say **governed autonomous remediation**, not unrestricted autonomous ops.
- Say **evidence-grounded diagnosis**, not guaranteed root-cause detection.
- Say **human approval for sensitive actions**, not human removal.
- Say **verified recovery**, not merely successful command execution.
- Do not claim financial savings or MTTR improvements without measured evidence.
- Do not present AOP as a replacement for Slack, ticketing, paging, or
  observability platforms; it coordinates and governs work across them.
