# How It Works

The framework has two levels: a four-phase pipeline that covers the full SDLC,
and an inner loop that runs within Phase 3 once per story. Most day-to-day use
is the inner loop; the outer phases are available when you need them.

---

## The four phases

```
PHASE 1 · Discovery
  discovery agent  →  requirements agent
  Input: a business ask, stakeholder docs, existing system inventory
  Output: requirements document (F-01..N functional, NFR-01..N non-functional, OIs numbered)
  Gate: human validates scope before Phase 2 begins

PHASE 2 · Design
  adr agent  →  lld agent  →  story_gen agent
  Input: requirements doc, architecture context
  Output: ADRs (decisions + trade-offs), LLD (schema + API contracts), story queue
  Gate: lead architect approves ADRs; tech lead approves LLD; PM approves queue

PHASE 3 · Build  ← the inner loop
  per story: planning → codegen → testgen → rfc
  Input: one story with acceptance criteria
  Output: implementation files, tests, PR description
  Gate: human APPROVE at each stage before advancing

PHASE 4 · Validate & Release
  shadow agent  →  review agent  →  release agent
  Input: the built system
  Output: divergence report, review report, cutover runbook + rollback plan
  Gate: shadow zero-divergence + review green + human sign-off before release
```

Phases 1–2 run once per initiative; Phase 3 loops over every story in the queue;
Phase 4 runs once at the end. If you already have a requirement and story list,
you can skip Phases 1–2 and start the loop directly in Phase 3.

---

## The inner loop — one story in detail

The most important thing to understand is what happens inside Phase 3, because
that's where the code gets written.

```
supervisor picks story A-02 (A-01 done → dependency met)
│
│  git checkout -b story/A-02              ← branch per story
│
├─ PLANNING AGENT  (strong tier)
│    reads: story AC + CONTEXT.md + context from completed stories
│    writes: pipeline/A-02/planning_context.json
│            (table specs, columns, keys, feature flags, idempotency rules, AC checklist)
│    ── HIL GATE ──  APPROVE / REVISE <feedback>
│
├─ CODE GEN AGENT  (mid tier)
│    reads: planning_context ONLY (context isolation — not the full transcript)
│    writes: all implementation files
│    ── supervisor runs `mvn test` (the real gate, not the agent's word) ──
│    if red → SELF-HEAL (hand the failure back, fix only that, max 3 tries)
│    ── HIL GATE ──  APPROVE / REVISE <feedback>
│
├─ TEST GEN AGENT  (mid tier)
│    reads: codegen file list + planning_context
│    writes: all test files
│    ── real test gate again ──  self-heal if red
│    ── HIL GATE ──  APPROVE
│
└─ RFC AGENT  (cheap tier)
     reads: planning_context + file lists + pipeline_state
     writes: pipeline/A-02/pr_summary.md
     ── HIL GATE ──  APPROVE → story marked DONE, branch committed
```

---

## Three design decisions that matter

**1. Context isolation**
Each agent receives only its declared inputs — planning gets the story AC,
codegen gets the planning context, testgen gets the file list. It never receives
the full accumulated conversation history. This is the primary reason token costs
stay flat as the queue grows: without isolation, costs grow quadratically with
queue length.

**2. The real test gate**
The supervisor runs your actual test command (`guardrails.test_command` in config)
and gates on the exit code. The agent self-reporting "tests pass" is never
accepted. This is what makes a green PR mean something: the tests actually ran.

**3. Self-heal with repetition detection**
When a gate fails and HIL is off, the supervisor sends the agent its own previous
output *plus the specific failure* — not just "try again." The agent fixes only
the listed violations. If the same failure recurs, the loop halts early rather
than burning all three attempts. This distinguishes feedback-driven correction
from dumb retry.

---

## Context carry-forward

Completed stories pass context to subsequent ones — entity classes, table names,
module paths. The planning agent receives a `context_carried` block listing what
has already been built, so it can reference rather than regenerate. This is why
A-02 in the worked example reuses A-01's table definition without re-creating it.

---

## The supervisor's role

The supervisor does not generate code or tests. It manages everything else:
- phase transitions and story queue order
- budget checks before every agent handoff
- error classification (transient → backoff, deterministic → self-heal, structural → escalate)
- state persistence (`pipeline_state.json`) after every gate
- telemetry emission per agent run
- git checkpoint and auto-revert on rejection

Everything the supervisor does is driven by `loop/config/loop.config.json`. There
are no magic defaults baked into the agents — the config file is the full
specification of how the loop behaves.
