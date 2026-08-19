import { describe, it, expect } from "vitest";
import { encodeSse, heartbeat, incidentMessage, snapshotMessage } from "./sse.js";
import type { Incident } from "./incident-store.js";

const incident: Incident = {
  id: "INC-1", scene: 1, sceneTitle: "Happy path", subject: "spike",
  lane: "PLANNED", status: "RUNNING", timeline: [], createdAt: "t", updatedAt: "t",
};

describe("sse", () => {
  it("builds a snapshot carrying the scenario catalogue and incidents", () => {
    const msg = snapshotMessage([incident]);
    expect(msg.type).toBe("snapshot");
    expect(msg.incidents).toEqual([incident]);
    expect(msg.scenarios.length).toBe(6);
  });

  it("builds an incident delta", () => {
    expect(incidentMessage(incident)).toEqual({ type: "incident", incident });
  });

  it("encodes a valid SSE frame with an event line and a terminating blank line", () => {
    const frame = encodeSse(incidentMessage(incident));
    expect(frame.startsWith("event: incident\ndata: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    const data = JSON.parse(frame.split("data: ")[1]!.trimEnd());
    expect(data.incident.id).toBe("INC-1");
  });

  it("emits a heartbeat comment", () => {
    expect(heartbeat()).toBe(": keep-alive\n\n");
  });
});
