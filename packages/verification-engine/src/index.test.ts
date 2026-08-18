import { describe, expect, it } from "vitest";
import { runVerification } from "./index.js";

describe("@aop/verification-engine barrel", () => {
  it("re-exports runVerification", () => {
    expect(typeof runVerification).toBe("function");
  });
});
