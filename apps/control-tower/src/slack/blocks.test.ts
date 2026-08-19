import { describe, it, expect } from "vitest";
import {
  APPROVE_ACTION_ID,
  REJECT_ACTION_ID,
  approvalRequestBlocks,
  approvalResolvedBlocks,
  incidentAnnouncementBlocks,
  statusUpdateText,
} from "./blocks.js";
import type { Incident } from "../incident-store.js";

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "INC-1", scene: 1, sceneTitle: "Happy path", subject: "checkout spike",
    lane: "WAITING_APPROVAL", status: "WAITING_APPROVAL", timeline: [],
    approval: { proposer: "sam-oncall", requiredRole: "senior_oncall", action: "restart_service", parameters: { version: "1.3.0" }, reason: "deploy regression" },
    createdAt: "t", updatedAt: "t", ...overrides,
  };
}

describe("blocks", () => {
  it("announces an incident with id, subject and scene", () => {
    const blocks = incidentAnnouncementBlocks(incident());
    expect(JSON.stringify(blocks)).toContain("INC-1");
    expect(JSON.stringify(blocks)).toContain("checkout spike");
    expect(JSON.stringify(blocks)).toContain("Scene 1");
  });

  it("prefixes a status line with the current lane", () => {
    expect(statusUpdateText(incident(), "✅ matched")).toBe("`WAITING_APPROVAL`  ✅ matched");
  });

  it("builds an approval card with Approve and Reject buttons carrying the incident id", () => {
    const blocks = approvalRequestBlocks(incident());
    const actions = blocks.find((b) => b.type === "actions") as unknown as { elements: { action_id: string; value: string }[] };
    expect(actions.elements.map((e) => e.action_id)).toEqual([APPROVE_ACTION_ID, REJECT_ACTION_ID]);
    expect(actions.elements.every((e) => e.value === "INC-1")).toBe(true);
    expect(JSON.stringify(blocks)).toContain("restart_service");
    expect(JSON.stringify(blocks)).toContain("1.3.0");
  });

  it("tolerates a missing approval object without throwing", () => {
    const blocks = approvalRequestBlocks(incident({ approval: undefined }));
    expect(JSON.stringify(blocks)).toContain("unknown");
    expect(JSON.stringify(blocks)).toContain("{}");
  });

  it("renders an approved resolution card (via Slack)", () => {
    const inc = incident({ approval: { ...incident().approval!, decision: "APPROVED", decidedBy: "riley-lead", decidedVia: "slack" } });
    const s = JSON.stringify(approvalResolvedBlocks(inc));
    expect(s).toContain("Approved");
    expect(s).toContain("riley-lead");
    expect(s).toContain("in Slack");
  });

  it("renders a rejected resolution card (via the UI)", () => {
    const inc = incident({ approval: { ...incident().approval!, decision: "REJECTED", decidedBy: "riley-lead", decidedVia: "ui" } });
    const s = JSON.stringify(approvalResolvedBlocks(inc));
    expect(s).toContain("Rejected");
    expect(s).toContain("in the Control Tower UI");
  });

  it("tolerates a missing approval when resolving", () => {
    const s = JSON.stringify(approvalResolvedBlocks(incident({ approval: undefined })));
    expect(s).toContain("Rejected");
  });
});
