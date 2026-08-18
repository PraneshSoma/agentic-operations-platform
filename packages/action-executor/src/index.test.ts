import { describe, expect, it } from "vitest";
import { assertMatchesFrozenPlan, UnapprovedActionError, ParameterChangedError } from "./index.js";

describe("@aop/action-executor barrel", () => {
  it("re-exports assertMatchesFrozenPlan, UnapprovedActionError, ParameterChangedError", () => {
    expect(typeof assertMatchesFrozenPlan).toBe("function");
    expect(UnapprovedActionError).toBeInstanceOf(Function);
    expect(ParameterChangedError).toBeInstanceOf(Function);
  });
});
