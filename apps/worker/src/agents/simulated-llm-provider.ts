import type { LLMCompletionInput, LLMCompletionOutput, LLMProvider } from "@aop/contracts";

/**
 * SimulatedLLMProvider — a deterministic, fixture-backed LLMProvider, not
 * a real system (same "simulated, not real" scope as B-04's
 * SimulatedFixtureConnector). Returns whatever raw text response was
 * configured for a given systemPrompt, so tests can exercise the
 * Investigator/Planner agents' own logic (parsing, evidence-grounding,
 * schema validation) deterministically, without a real API credential.
 * A real @anthropic-ai/sdk-backed adapter is deferred — see
 * packages/contracts/src/llm-provider.ts's file header for why.
 */
export class SimulatedLLMProvider implements LLMProvider {
  constructor(private readonly response: string | ((input: LLMCompletionInput) => string)) {}

  async complete(input: LLMCompletionInput): Promise<LLMCompletionOutput> {
    const text = typeof this.response === "function" ? this.response(input) : this.response;
    return { text, model: "simulated-llm-provider" };
  }
}
