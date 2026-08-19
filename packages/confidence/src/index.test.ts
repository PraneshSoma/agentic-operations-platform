import { describe, expect, it } from "vitest";
import { assembleConfidenceDimensions } from "./index.js";

describe("@aop/confidence barrel", () => {
  it("re-exports assembleConfidenceDimensions", () => {
    expect(typeof assembleConfidenceDimensions).toBe("function");
  });
});
