# Guardrails

How the framework prevents runaway token consumption, broken code reaching review,
and uncontrolled autonomous behaviour. All of this is configurable in
`loop/config/loop.config.json`; nothing is enforced invisibly.

---

## Budgets — hard stops

The supervisor checks these before every agent handoff. First one to trip halts
the loop and saves state; you resume after investigating.

| Budget | Default | What triggers it |
|---|---|---|
| `per_agent_tokens` | varies by agent | one agent call consumes too many tokens |
| `per_story_tokens` | 200,000 | a single story exceeds the ceiling |
| `per_run_tokens` | 3,000,000 | the whole run exceeds the ceiling |
| `max_iterations_per_story` | 12 | too many gate-retry cycles on one story |
| `max_wall_clock_min_per_story` | 25 min | a story takes too long |
| `spend_cap_usd_per_run` | $12 | total dollar cost exceeds the cap |

An alert fires at 80% of any ceiling (`alert_pct`). You can tighten any budget
at launch without editing the config:

```
/run-pipeline req=YOUR-ID --max-story-tokens=150000 --spend-cap=8
```

The loop accepts the lower of config vs flag. It never raises a budget silently.

### Why costs stay flat across a long queue
The primary cost control is **context isolation** — each agent receives only its
declared inputs, not the full conversation history. Without isolation, token cost
grows roughly as the square of queue length (because every call re-bills all
prior context). With isolation, each agent call is bounded by its own input, and
cost grows linearly. The per-agent token ceilings are a backstop, not the
primary defence.

---

## The real test gate

After codegen and testgen, the supervisor runs your test + lint commands and gates
on the actual exit codes:

```jsonc
"test_command": "mvn -q test",
"lint_command": "mvn -q checkstyle:check"
```

An agent self-reporting "all tests pass" is never accepted. If the commands fail,
the loop classifies the failure and responds accordingly (see Self-Heal below).

This is what makes a green PR mean something: the tests actually ran green, not
just the agent's assessment of them.

---

## Self-heal — feedback-driven correction

When a deterministic gate fails (test failure, lint failure, quality check), the
supervisor does not blindly retry. It:

1. Sends the agent its **own previous output** as context
2. Includes the **specific failed checks** — file, violation, line hint
3. Instructs the agent to **fix only those violations**, output only the corrected files

```json
{
  "self_heal": {
    "retry_number": 1,
    "failed_checks": [
      { "check": "<gate that failed>",
        "violation": "<exact problem from the test output>",
        "file": "<path>", "line_hint": "<where to look>" }
    ],
    "prior_output_summary": "<the agent's previous output>",
    "instruction": "Fix ONLY the listed violations. Do not regenerate passing files."
  }
}
```

**Repetition detection:** if the same `failed_checks` recur across self-heal
attempts, the loop halts early instead of burning all three attempts. This catches
the case where the rule the agent is violating isn't in the agent's instructions —
the fix is to add it to `codegen.md`, not to retry more times.

Maximum 3 self-heal attempts per stage. After that, the loop halts and escalates
to a human.

---

## Error taxonomy

The supervisor classifies every failure before reacting. The three types get
different responses:

| Type | Examples | Response |
|---|---|---|
| **Transient** | rate limit, timeout, 5xx | exponential backoff, retry up to 3× |
| **Deterministic** | test failure, lint failure, quality gate | self-heal (feedback-driven) |
| **Structural** | compile error, missing dependency, ambiguous spec | halt, escalate to human |

This prevents transient infrastructure failures from triggering self-heal (which
is expensive) and prevents systematic issues from consuming all retry budget
before escalating.

---

## Git checkpoints

Every story runs on its own branch (`story/<ID>`). If a story's gate is rejected,
or self-heal is exhausted, the working tree auto-reverts to the pre-story state.
Nothing broken accumulates on the branch across stories.

Approved stories are committed before the loop advances. The trunk only ever
sees stories that passed every gate.

---

## HIL gates — the human stays in control

Every stage has a human review gate on by default. The loop pauses and presents:

```
[HIL GATE — CODEGEN — Story A-02]
<output summary>  |  gate: PASS (mvn test green)  |  budget: 47k / 200k
Commands: APPROVE | REVISE <feedback> | SKIP | PAUSE | HALT
```

- `APPROVE` — advance. The supervisor commits the output and moves to the next stage.
- `REVISE <feedback>` — the stage reruns with your feedback injected as context.
- `SKIP` — this story is skipped; the loop moves to the next story in the queue.
- `PAUSE` — the loop finishes the current stage, saves state, and stops cleanly.
- `HALT` — stop immediately, save state. Resume with `/run-pipeline resume`.

Gates can be turned off per stage in config (`"hil": {"codegen": false}`) once
you trust a stage on your codebase. Turned-off stages auto-gate on the real test
result and self-heal on failure. The release stage should always stay gated.

---

## Additional safeguards

- **Secret scan** — the supervisor scans generated files before writing. Any
  match on credential patterns blocks the write.
- **Atomic state writes** — `pipeline_state.json` is written via temp-file +
  rename. A crash mid-write leaves the previous state intact.
- **Run lock** — prevents two engineers from running the same initiative
  concurrently against the same state file.
- **Version pinning** — each run records the prompt version hash and exact model
  version for every agent. Runs are replayable; a regression is attributable to
  a specific change.
- **Append-only, hash-chained audit log** — each audit entry hashes the previous
  one. The log is tamper-evident.
