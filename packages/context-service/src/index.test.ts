import { describe, expect, it } from "vitest";
import { assembleContextPackage, ContextUnavailableError, SimulatedFixtureConnector } from "./index.js";

describe("@aop/context-service barrel", () => {
  it("re-exports assembleContextPackage, ContextUnavailableError, SimulatedFixtureConnector", () => {
    expect(typeof assembleContextPackage).toBe("function");
    expect(ContextUnavailableError).toBeInstanceOf(Function);
    expect(SimulatedFixtureConnector).toBeInstanceOf(Function);
  });
});
