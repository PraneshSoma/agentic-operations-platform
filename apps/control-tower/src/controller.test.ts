import { describe, it, expect, vi } from "vitest";
import { Controller, defaultSubject, type TriggerContext } from "./controller.js";
import { DecisionRegistry } from "./decision-registry.js";
import { IncidentStore } from "./incident-store.js";

const NOW = new Date("2026-08-19T12:00:00.000Z");

function make(nextId?: () => string) {
  const store = new IncidentStore();
  const decisions = new DecisionRegistry();
  const run = vi.fn<(ctx: TriggerContext) => void>();
  const controller = new Controller({ store, decisions, run, now: () => NOW, nextId });
  return { store, decisions, run, controller };
}

describe("Controller", () => {
  it("triggers the happy path by default, creating an incident and invoking the runner", () => {
    const { store, run, controller } = make(() => "INC-1");
    const result = controller.trigger({});
    expect(result).toEqual({ ok: true, incidentId: "INC-1", scenario: expect.objectContaining({ scene: 1 }) });
    expect(store.get("INC-1")?.subject).toBe("Checkout error rate spike");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ incidentId: "INC-1", scenario: expect.objectContaining({ scene: 1 }) }));
  });

  it("triggers a scenario by key", () => {
    const { run, controller } = make(() => "INC-2");
    const r = controller.trigger({ key: "budget" });
    expect(r.ok).toBe(true);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ scenario: expect.objectContaining({ scene: 6 }) }));
  });

  it("triggers a scenario by scene number", () => {
    const { controller } = make(() => "INC-3");
    const r = controller.trigger({ scene: 3 });
    expect(r.ok && r.scenario.key).toBe("frozen-plan");
  });

  it("passes a custom subject through, trimming it, and Slack thread context", () => {
    const { store, run, controller } = make(() => "INC-4");
    controller.trigger({ subject: "  DB latency  ", slackChannel: "C1", slackThreadTs: "9.9" });
    expect(store.get("INC-4")?.subject).toBe("DB latency");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ slackChannel: "C1", slackThreadTs: "9.9", subject: "DB latency" }));
  });

  it("uses the per-scene default subject when a blank one is given", () => {
    const { store, controller } = make(() => "INC-5");
    controller.trigger({ scene: 2, subject: "   " });
    expect(store.get("INC-5")?.subject).toBe("Something is wrong with the service");
  });

  it("rejects an unknown scenario without creating an incident or running", () => {
    const { store, run, controller } = make();
    const r = controller.trigger({ key: "does-not-exist" });
    expect(r).toEqual({ ok: false, reason: "unknown_scenario" });
    expect(store.list()).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("uses the built-in sequential id generator when none is injected", () => {
    const { controller } = make();
    const a = controller.trigger({});
    const b = controller.trigger({});
    expect(a.ok && a.incidentId).toBe("INC-1001");
    expect(b.ok && b.incidentId).toBe("INC-1002");
  });

  it("routes a decision to the registry (true once, false on the late second)", async () => {
    const { decisions, controller } = make(() => "INC-6");
    const p = decisions.await("INC-6");
    expect(controller.decide("INC-6", "APPROVED", "riley-lead", "slack")).toBe(true);
    expect(controller.decide("INC-6", "REJECTED", "sam", "ui")).toBe(false);
    await expect(p).resolves.toMatchObject({ decision: "APPROVED", via: "slack" });
  });
});

describe("defaultSubject", () => {
  it("has a distinct line for every scene and a fallback", () => {
    const subjects = [1, 2, 3, 4, 5, 6].map(defaultSubject);
    expect(new Set(subjects).size).toBe(6);
    expect(defaultSubject(99)).toBe("Incident");
  });
});
