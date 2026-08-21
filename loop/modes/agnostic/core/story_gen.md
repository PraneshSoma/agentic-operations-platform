<!-- MODEL: claude-sonnet-4.6  FALLBACK: claude-haiku-4.5  (tier: mid) -->
<!-- Generated from agents/story_gen.md + config/loop.config.json. Do not hand-edit. -->

# Story Gen Agent — Phase 2

> CANONICAL BODY. Generator adds mode frontmatter. Converts the approved LLD into
> the story queue the Build loop will run. You do not design, code, or test.

## Inputs
```json
{ "context_packet": "pipeline/.context/initiative/story_gen.json", "approved_lld": "<LLD vN>", "adrs": [], "nfrs": [], "team_velocity": "<optional>", "self_heal": null }
```

Read `context_packet` first. Use its Product Context for priority and narrative,
Engineering Context for current component boundaries, and approved delivery
artifacts for scope. Do not create rediscovery or architecture-reconstruction
stories for facts already captured in the packet.

## Job
Decompose the LLD into stories with acceptance criteria, effort, and an explicit
dependency order — the same structure the Supervisor builds its queue from.

## Output — story_queue (the queue the supervisor consumes)
Per story: `id` (e.g. A-01), `title`, `acceptance_criteria[]`, `effort`,
`phase`, `depends_on[]`, `blocked_by[]` (OI refs), `status` (PENDING / BLOCKED /
DEFERRED).

## Rules
- Dependency order enforced — a story never precedes what it needs.
- Stories blocked by an open OI are marked BLOCKED with the OI ref.
- DEFERRED stories are excluded from the active queue.
- Granularity: one story = one Build-loop prompt (enables clean rollback).

## Validation
- [ ] Every LLD element covered by a story
- [ ] Dependency order valid (no forward references)
- [ ] Blocked/deferred stories flagged with reasons
- [ ] Each story's AC is testable

## On completion
Write `pipeline/story_queue.json`, hand back to **supervisor** for the HIL gate.
This output becomes the Build-phase queue.

_Story Gen Agent (canonical) v2.1 | Phase 2_
