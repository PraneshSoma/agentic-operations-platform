import { describe, it, expect } from "vitest";
import { DecisionRegistry } from "./decision-registry.js";

describe("DecisionRegistry (approve from anywhere)", () => {
  it("resolves a parked decision and settles the awaited promise", async () => {
    const reg = new DecisionRegistry();
    const p = reg.await("INC-1");
    expect(reg.isPending("INC-1")).toBe(true);
    const settled = reg.resolve("INC-1", { decision: "APPROVED", actorId: "riley-lead", via: "ui" });
    expect(settled).toBe(true);
    await expect(p).resolves.toEqual({ decision: "APPROVED", actorId: "riley-lead", via: "ui" });
    expect(reg.isPending("INC-1")).toBe(false);
  });

  it("first resolver wins; the second (late click from the other surface) is a no-op", async () => {
    const reg = new DecisionRegistry();
    const p = reg.await("INC-2");
    expect(reg.resolve("INC-2", { decision: "APPROVED", actorId: "riley", via: "slack" })).toBe(true);
    expect(reg.resolve("INC-2", { decision: "REJECTED", actorId: "sam", via: "ui" })).toBe(false);
    await expect(p).resolves.toMatchObject({ decision: "APPROVED", via: "slack" });
  });

  it("resolving an unknown incident returns false", () => {
    const reg = new DecisionRegistry();
    expect(reg.resolve("ghost", { decision: "APPROVED", actorId: "x", via: "ui" })).toBe(false);
    expect(reg.isPending("ghost")).toBe(false);
  });

  it("rejects registering two pending decisions for the same incident", () => {
    const reg = new DecisionRegistry();
    void reg.await("INC-3");
    expect(() => reg.await("INC-3")).toThrow(/already pending/);
  });
});
