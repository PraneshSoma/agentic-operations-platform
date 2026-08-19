import { describe, it, expect } from "vitest";
import { parseInteractionPayload } from "./parse-interaction.js";
import { APPROVE_ACTION_ID, REJECT_ACTION_ID } from "./blocks.js";

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "block_actions",
    user: { id: "U123" },
    channel: { id: "C1" },
    message: { ts: "111.1" },
    actions: [{ action_id: APPROVE_ACTION_ID, value: "INC-1" }],
    ...overrides,
  });
}

describe("parseInteractionPayload", () => {
  it("parses an Approve click", () => {
    const r = parseInteractionPayload(payload());
    expect(r).toEqual({ ok: true, interaction: { incidentId: "INC-1", decision: "APPROVED", slackUserId: "U123", messageTs: "111.1", channel: "C1" } });
  });

  it("parses a Reject click", () => {
    const r = parseInteractionPayload(payload({ actions: [{ action_id: REJECT_ACTION_ID, value: "INC-2" }] }));
    expect(r.ok && r.interaction.decision).toBe("REJECTED");
  });

  it("defaults optional fields when user/message/channel are absent", () => {
    const r = parseInteractionPayload(JSON.stringify({ type: "block_actions", actions: [{ action_id: APPROVE_ACTION_ID, value: "INC-9" }] }));
    expect(r).toEqual({ ok: true, interaction: { incidentId: "INC-9", decision: "APPROVED", slackUserId: "unknown", messageTs: undefined, channel: undefined } });
  });

  it("rejects unparseable JSON", () => {
    expect(parseInteractionPayload("{not json")).toEqual({ ok: false, reason: "unparseable" });
  });

  it("rejects a non block_actions payload", () => {
    expect(parseInteractionPayload(JSON.stringify({ type: "view_submission" }))).toEqual({ ok: false, reason: "not_block_actions" });
  });

  it("rejects a payload with no actions, a non-array actions, or a malformed action", () => {
    expect(parseInteractionPayload(JSON.stringify({ type: "block_actions", actions: [] })).ok).toBe(false);
    expect(parseInteractionPayload(JSON.stringify({ type: "block_actions", actions: "x" })).ok).toBe(false);
    expect(parseInteractionPayload(JSON.stringify({ type: "block_actions", actions: [{ action_id: 5, value: "INC-1" }] }))).toEqual({ ok: false, reason: "no_action" });
    expect(parseInteractionPayload(JSON.stringify({ type: "block_actions", actions: [{ action_id: APPROVE_ACTION_ID, value: 5 }] }))).toEqual({ ok: false, reason: "no_action" });
  });

  it("rejects an unknown action_id", () => {
    expect(parseInteractionPayload(payload({ actions: [{ action_id: "aop_other", value: "INC-1" }] }))).toEqual({ ok: false, reason: "unknown_action" });
  });
});
