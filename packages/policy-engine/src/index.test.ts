import { describe, expect, it } from "vitest";
import { matchOpc, TextOverlapSemanticMatcher, InMemoryOpcMatchEvidenceSink } from "./index.js";

describe("@aop/policy-engine barrel", () => {
  it("re-exports matchOpc, TextOverlapSemanticMatcher, InMemoryOpcMatchEvidenceSink", () => {
    expect(typeof matchOpc).toBe("function");
    expect(new TextOverlapSemanticMatcher()).toBeInstanceOf(TextOverlapSemanticMatcher);
    expect(new InMemoryOpcMatchEvidenceSink()).toBeInstanceOf(InMemoryOpcMatchEvidenceSink);
  });
});
