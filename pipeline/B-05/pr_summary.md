# B-05: Investigator agent integration

**Phase:** B — Happy-path runtime
**Depends on:** B-03, B-04
**Status:** DONE

## Summary

`apps/worker/src/agents/investigator.ts`: spec §11's Investigator Agent.
Calls an injected `LLMProvider`, validates the response against a new
`InvestigationResultSchema`, then runs a second, semantic validation pass
— evidence-grounding — that a Zod schema alone cannot express.

## Contract gaps closed

- **`InvestigationResultSchema`** (spec §11) — same kind of gap A-02/B-03 caught (`VerificationResult`, `PlatformEvent`): referenced by this story's acceptance criteria, had no schema anywhere.
- **`LLMProvider` interface** — CONTEXT.md's stack section explicitly names this ("packages/contracts defines the interface; a concrete @anthropic-ai/sdk adapter implements it") but it didn't exist yet either. Added as a plain TS interface (not a Zod schema — CONTEXT.md RULE 1 governs data contracts, not provider/behavior abstractions), alongside `packages/contracts/src/schemas/`.

## Design decisions

- **No real `@anthropic-ai/sdk` adapter in this story.** There is no API
  credential available in this environment to build or exercise one
  against a real endpoint, and neither of B-05's acceptance criteria
  requires a live external call — both are about the *shape* and
  *grounding* of the agent's output, which is provider-independent. A
  `SimulatedLLMProvider` (deterministic, fixture-driven — same "simulated,
  not real" family as B-04's `SimulatedFixtureConnector`) fills the role;
  adding the real adapter later touches no call site, per the interface's
  own stated purpose.
- **Evidence-grounding is a second validation pass, not folded into the
  schema.** `InvestigationResultSchema` only enforces shape — a Zod schema
  has no way to know what evidence actually exists. `runInvestigation()`
  separately collects every `evidence_id` referenced across observations/
  hypotheses/diagnosis and checks each against the known evidence universe
  derived from the `ContextPackage` (scoped to
  `runtime_context.logs.evidence_refs` — the one field spec §8.1 literally
  types as a list of evidence references; a full Evidence Ledger
  cross-check is E-01's job once real persistence exists).
- **An invented evidence_id throws (`InventedEvidenceError`), not a
  silent strip.** A diagnosis built partly on invented evidence isn't a
  diagnosis this platform can trust with a lesser fix — rejecting the
  whole result is the only response consistent with spec §11's "may not
  invent connector results" being a hard rule, not a preference.
- **Hypothesis status enforcement is structural, not agent-logic**:
  `InvestigationResultSchema`'s `status` field is a required, closed
  3-value enum — there is no way for a hypothesis to parse successfully
  without being marked `supported`/`rejected`/`unresolved` explicitly.

## Files

- `packages/contracts/src/schemas/investigation-result.ts` (+ test).
- `packages/contracts/src/llm-provider.ts` — the interface (excluded from coverage: `export interface` erases to zero runtime statements — nothing to test).
- `apps/worker/src/agents/investigator.ts` (+ test) — the core of this story.
- `apps/worker/src/agents/simulated-llm-provider.ts` (+ test).

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 35 test files, 291 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Every factual claim in the diagnosis traces to an `evidence_id` — no invented connector results (F-05) — `CRITICAL`-labeled tests for both `supporting_evidence_ids` and `contradicting_evidence_ids`, plus a test confirming the exact invented ID(s) are named on the thrown error
- [x] Hypotheses marked supported/rejected/unresolved explicitly — enforced structurally by the schema's required, closed enum; verified by a schema-level test rejecting a hypothesis with a missing `status`
