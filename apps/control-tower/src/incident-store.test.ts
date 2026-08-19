import { describe, it, expect } from "vitest";
import { IncidentStore, LANES, type Incident } from "./incident-store.js";

const AT = "2026-08-19T12:00:00.000Z";
const AT2 = "2026-08-19T12:01:00.000Z";

function make(): { store: IncidentStore; created: Incident } {
  const store = new IncidentStore();
  const created = store.create({ id: "INC-1", scene: 1, sceneTitle: "Happy path", subject: "spike", at: AT });
  return { store, created };
}

describe("IncidentStore", () => {
  it("exposes the lanes in pipeline order starting at RECEIVED and ending at RESOLVED", () => {
    expect(LANES[0]).toBe("RECEIVED");
    expect(LANES[LANES.length - 1]).toBe("RESOLVED");
  });

  it("creates an incident in RECEIVED/RUNNING with empty timeline", () => {
    const { created } = make();
    expect(created.lane).toBe("RECEIVED");
    expect(created.status).toBe("RUNNING");
    expect(created.timeline).toEqual([]);
    expect(created.createdAt).toBe(AT);
    expect(created.updatedAt).toBe(AT);
  });

  it("lists and gets incidents", () => {
    const { store } = make();
    expect(store.list()).toHaveLength(1);
    expect(store.get("INC-1")?.id).toBe("INC-1");
    expect(store.get("nope")).toBeUndefined();
  });

  it("rejects a duplicate id", () => {
    const { store } = make();
    expect(() => store.create({ id: "INC-1", scene: 1, sceneTitle: "x", subject: "y", at: AT })).toThrow(/already exists/);
  });

  it("notifies subscribers on create and change, and stops after unsubscribe", () => {
    const store = new IncidentStore();
    const seen: string[] = [];
    const unsub = store.subscribe((i) => seen.push(i.status));
    store.create({ id: "INC-9", scene: 2, sceneTitle: "t", subject: "s", at: AT });
    store.setStatus("INC-9", AT2, "ESCALATED");
    unsub();
    store.setStatus("INC-9", AT2, "FAILED");
    expect(seen).toEqual(["RUNNING", "ESCALATED"]);
  });

  it("appends timeline entries with auto-incrementing seq and bumps updatedAt", () => {
    const { store } = make();
    store.append("INC-1", AT2, { kind: "ok", text: "matched", evidenceType: "CONTEXT" });
    store.append("INC-1", AT2, { kind: "step", text: "next" });
    const inc = store.get("INC-1")!;
    expect(inc.timeline.map((t) => t.seq)).toEqual([1, 2]);
    expect(inc.timeline[0]).toMatchObject({ kind: "ok", text: "matched", evidenceType: "CONTEXT", at: AT2 });
    expect(inc.updatedAt).toBe(AT2);
  });

  it("sets lane, status, approval and slack link", () => {
    const { store } = make();
    store.setLane("INC-1", AT2, "PLANNED");
    store.setStatus("INC-1", AT2, "WAITING_APPROVAL");
    store.setApproval("INC-1", AT2, { proposer: "sam", requiredRole: "senior_oncall", action: "restart_service", parameters: { version: "1.3.0" }, reason: "spike" });
    store.setSlack("INC-1", AT2, { channel: "C1", threadTs: "111.1" });
    const inc = store.get("INC-1")!;
    expect(inc.lane).toBe("PLANNED");
    expect(inc.status).toBe("WAITING_APPROVAL");
    expect(inc.approval?.action).toBe("restart_service");
    expect(inc.slack).toEqual({ channel: "C1", threadTs: "111.1" });
  });

  it("records a decision on a pending approval", () => {
    const { store } = make();
    store.setApproval("INC-1", AT2, { proposer: "sam", requiredRole: "senior_oncall", action: "restart_service", parameters: {}, reason: "r" });
    store.recordDecision("INC-1", AT2, "APPROVED", "riley-lead", "slack");
    const a = store.get("INC-1")!.approval!;
    expect(a).toMatchObject({ decision: "APPROVED", decidedBy: "riley-lead", decidedVia: "slack", decidedAt: AT2 });
  });

  it("throws recording a decision with no pending approval", () => {
    const { store } = make();
    expect(() => store.recordDecision("INC-1", AT2, "APPROVED", "riley", "ui")).toThrow(/no pending approval/);
  });

  it("throws on any mutation of an unknown incident", () => {
    const { store } = make();
    expect(() => store.append("nope", AT2, { kind: "step", text: "x" })).toThrow(/No incident nope/);
    expect(() => store.setLane("nope", AT2, "PLANNED")).toThrow(/No incident nope/);
  });
});
