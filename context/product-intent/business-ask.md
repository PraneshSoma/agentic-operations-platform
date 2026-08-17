# Business Ask

> Feeds Discovery's `business_ask` input (`loop/agents/discovery.md`).

## The raw ask

Build a platform that lets an operations organization resolve real
operational tickets (incidents, reconciliation, access/entitlement issues,
...) with AI assistance — investigation, diagnosis, and resolution planning —
**without** handing an AI direct write access to production systems, and
**without** hand-building bespoke automation per ticket type. Prove it end to
end on one real ticket at Tenant #1 before generalizing.

## Problem, in the shape Discovery needs it

Today, resolving an operational ticket is either:

1. **Fully manual** — an engineer or operator investigates by hand across
   logs, metrics, and tribal knowledge, then makes the change themselves. Slow,
   inconsistent, and undocumented — the "why" of a fix rarely survives past
   the ticket comment thread.
2. **Ad hoc AI-assisted** — someone pastes context into a chatbot and copies
   its suggestion into a terminal. Faster, but ungoverned: no policy gate, no
   approval trail, no verification step, no evidence record, and the AI's
   authority to act is whatever the operator's own access already permits.

Neither path scales into something a platform/security/compliance
organization can stand behind, and neither produces the evidence trail that
makes the *next* similar ticket faster to resolve.

## What "solved" looks like at MVP

Per the spec's own primary objective: **one real Tenant #1 ticket, executed
end to end** through config-driven Operational Procedure Contracts (OPCs),
bounded evidence-backed context assembly, a deterministic policy engine,
human approval above R0/R1 risk, governed action execution, mandatory
verification, and a complete evidence trail — with the runtime itself
carrying zero ticket-type-specific code (spec §1.1, validated by §34's
acceptance criteria).

Success is not "the AI gave a good answer." Success is: the mutation that
happened was authorized, verified, and auditable, and a second, unrelated
ticket type runs on the same runtime with zero code changes (spec §34, §38
Iteration 6).

## Who this is for

An operations/SRE/platform organization (Tenant #1) that already runs
incident and ticket workflows through some combination of chat (Slack),
ticketing, and paging tooling, and wants AI-assisted resolution that their
security/compliance function can approve — not a general-purpose ops
chatbot, and not a no-human-in-the-loop autonomous remediation system (that's
explicitly out of scope past L3 — spec §17.1).

## Non-goals, at the business level

(Distinct from the spec's own engineering non-goals in its header — these are
why, not what.)

- Not a ticketing system, paging system, or chat tool — it sits on top of
  ones that already exist.
- Not a replacement for the humans who own approval authority — it narrows
  and evidences their decision, it doesn't remove it (v0.2 ceiling: L3,
  human-approved execution).
- Not selling "autonomous ops" — the product's own thesis (spec §40) is
  explicit that historical outcomes *eventually* enable governed autonomy,
  not that autonomy is the v1 pitch.

## Open items

- **OI-CTX-01**: Who is Tenant #1, concretely — industry, team size, existing
  on-call maturity? This shapes which OPC (§35's A/B/C) is worth piloting
  first and what "one real ticket" should actually be. Blocks: Discovery's
  scope boundaries, Story Gen's Phase D real-connector choice.
- **OI-CTX-02**: What triggered this initiative — a specific incident, a
  budget/headcount pressure, a compliance mandate, a competitive bet? Not
  captured anywhere yet. Blocks: how Discovery frames pain points and how
  Control Tower's capacity/ROI metrics (§27.1) should be pitched to
  leadership.
