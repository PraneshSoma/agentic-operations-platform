/**
 * LLMProvider — the interface every LLM-backed agent (Investigator,
 * Planner) calls through (CONTEXT.md's stack decision: "Anthropic Claude
 * for the Investigator and Planner agents, behind a provider interface —
 * packages/contracts defines the interface; a concrete @anthropic-ai/sdk
 * adapter implements it — so a second provider can be added without
 * touching call sites").
 *
 * Deliberately NOT a Zod schema like everything else in this package:
 * this is a service/behavior interface (an async method), not a data
 * shape to validate at a boundary — CONTEXT.md RULE 1 governs domain
 * contracts, not provider abstractions. It lives here rather than in a
 * specific agent's package because both packages/contracts's own
 * convention ("every other package imports from this one") and
 * CONTEXT.md's stack section place it here explicitly, so Investigator
 * (apps/worker) and Planner (apps/worker) share one definition.
 *
 * No concrete @anthropic-ai/sdk adapter exists yet in this repo: there is
 * no API credential available to build or exercise one against a real
 * endpoint in this environment, and none of the current MVP stories'
 * acceptance criteria require a live external call — they're about the
 * *shape* and *grounding* of an agent's output, which is provider-
 * independent. A SimulatedLLMProvider (apps/worker/src/agents) fills the
 * role for now; adding the real adapter later touches no call site.
 */
export interface LLMCompletionInput {
  systemPrompt: string;
  userPrompt: string;
}

export interface LLMCompletionOutput {
  /** Raw text response — callers parse/validate it against their own expected schema. */
  text: string;
  model: string;
}

export interface LLMProvider {
  complete(input: LLMCompletionInput): Promise<LLMCompletionOutput>;
}
