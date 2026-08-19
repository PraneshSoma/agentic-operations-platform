# Demo guide — Agentic Operations Platform

A ~10-minute live demo you can run in a terminal. It runs the **real
platform code** in-process (the same code the 706-test suite covers) — no
mocks, no slides required, deterministic every time.

> **Want an interactive version instead?** There's a live web **Control
> Tower** UI — one trigger, a board that streams the pipeline in real time, an
> approval gate you can act on from the UI *or* a real Slack thread, and
> buttons for all five guardrails. Run `pnpm ui` (or `./run-demo.sh ui`) and
> open <http://localhost:4000>. Full guide, including the real-Slack setup:
> [`apps/control-tower/README.md`](apps/control-tower/README.md). The CLI demo
> below stays the quickest, most deterministic option for a talk.

## Run it locally (from a fresh machine)

Prerequisites: **Node 20+** and **pnpm** (via `corepack`, bundled with
Node). No database, no Docker, nothing else.

```bash
git clone https://github.com/PraneshSoma/agentic-operations-platform.git
cd agentic-operations-platform

corepack enable            # activates the pinned pnpm version
pnpm install               # also generates the Prisma client (postinstall)
pnpm demo
```

That's it — the whole thing prints in a few seconds, the same every run.

If your environment skips lifecycle scripts during install (some locked-down
setups do), run the Prisma step once by hand, then the demo:

```bash
pnpm --filter @aop/evidence-ledger exec prisma generate
pnpm demo
```

(The demo needs **no** database. The DB is only for the persistence
integration tests — see "Going deeper" below.)

## The pitch, in one line

> It does the operational work an on-call engineer would — investigate,
> plan, act, verify — but it is **governed**: it refuses, provably, to do
> the wrong thing.

The demo is two halves: **Scene 1** shows it doing the work end to end;
**Scenes 2–6** are five deliberate attempts to make it misbehave, each one
caught.

## Scene-by-scene talk track

**Scene 1 — An incident, governed end to end.**
Walk the audience down the ✓ list: an incident comes in → it picks the
right operating procedure → assembles context from connectors →
produces an **evidence-grounded** diagnosis (it can only cite evidence
that exists) → freezes a plan → the policy engine says a human must
approve an R2 production action → a *different* human approves, and the
action runs under that **approver's** identity, not a service account →
preflight passes → it executes against a sandbox → verifies the result →
and the **entire run is reconstructed from the evidence ledger**.
Point at the confidence line: *itemized dimensions, never a single made-up
percentage.*

**Scene 2 — Ambiguous ticket.** A vague ticket scores nearly equal against
two procedures. It **escalates to a human instead of guessing.** Say:
"the failure mode we care about isn't 'it's slow' — it's 'it confidently
did the wrong remediation.' Below a confidence margin, it hands off."

**Scene 3 — Frozen Plan Rule.** After approval, the executor tries to run a
*different* parameter than what was approved. **Blocked.** Say: "what a
human approved is exactly what runs — any drift forces re-approval."

**Scene 4 — Preflight drift.** A valid approval, but the world changed
between approval and execution. **Execution refused, sandbox untouched.**
Say: "even a legitimate approval can't run against a system that changed
underneath it."

**Scene 5 — Emergency halt.** An operator's self-*claimed* role is ignored
— the unauthorized actor is refused, the genuinely authorized one halts
the run instantly, and **the halt itself is on the audit trail.**

**Scene 6 — Budget guardrail.** A runaway investigation blows its token
ceiling. It **escalates rather than presenting a truncated answer as
complete.**

Closing line: *"It did the work — and refused, five different ways, to do
the wrong thing. Every one of those refusals is a test that fails the
build if it ever regresses."*

## If someone asks "is this real or staged?"

- It's the real code: `apps/demo/src/run.ts` imports the actual platform
  packages (`@aop/policy-engine`, `@aop/action-executor`, …) and calls
  them exactly as the system does.
- Every behavior shown is pinned by a `CRITICAL`-labeled test — 102 of
  them across the suite. `pnpm test` proves them; the demo *shows* them.
- It's deterministic: same inputs, same output, every run. Nothing to
  flake mid-presentation.

## Going deeper (optional, after the demo)

- **The guarantees, as tests:** `pnpm test` → 706 tests, 100% coverage.
- **The persistence guarantees (append-only evidence, cross-tenant
  isolation, transaction atomicity):** these need a real Postgres —
  `pnpm test:integration` against a `DATABASE_URL`. 36 integration tests.
- **The acceptance bar:** the spec's §34 "Prototype Acceptance Criteria"
  (18 invariants) — nearly all map 1:1 to a test named in that criterion.
- **Where it stops:** everything shown uses a *simulated* action connector
  (safe by design). Real production connectors and a real pilot are the
  explicitly-scoped next phase (Phase G), blocked on real-tenant
  decisions — worth naming so the demo isn't oversold.
