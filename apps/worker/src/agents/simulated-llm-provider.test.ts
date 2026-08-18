import { describe, expect, it } from "vitest";
import { SimulatedLLMProvider } from "./simulated-llm-provider.js";

describe("SimulatedLLMProvider", () => {
  it("returns a fixed string response regardless of input", async () => {
    const provider = new SimulatedLLMProvider("hello world");
    const result = await provider.complete({ systemPrompt: "sys", userPrompt: "user" });
    expect(result.text).toBe("hello world");
    expect(result.model).toBe("simulated-llm-provider");
  });

  it("supports a function response for input-dependent test fixtures", async () => {
    const provider = new SimulatedLLMProvider((input) => `echo: ${input.userPrompt}`);
    const result = await provider.complete({ systemPrompt: "sys", userPrompt: "ping" });
    expect(result.text).toBe("echo: ping");
  });
});
