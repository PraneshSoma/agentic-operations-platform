import { describe, expect, it } from "vitest";
import { PlatformEventSchema, RECOMMENDED_EVENT_TYPES } from "./platform-event.js";

const validPayload = {
  event_id: "evt_1",
  event_type: "execution.started",
  tenant_id: "tenant_1",
  request_id: "req_1",
  execution_id: "exec_1",
  occurred_at: "2026-08-18T00:00:00.000Z",
  payload_ref: "evidence_ref_1",
  correlation_id: "corr_1",
};

describe("PlatformEventSchema", () => {
  it("accepts a valid payload matching spec §22's shape", () => {
    expect(PlatformEventSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts any event_type string — spec §22 types it as an unconstrained string, not an enum", () => {
    const custom = { ...validPayload, event_type: "some.future.event.not.in.the.recommended.list" };
    expect(PlatformEventSchema.safeParse(custom).success).toBe(true);
  });

  it.each(["event_id", "event_type", "tenant_id", "request_id", "execution_id", "occurred_at", "payload_ref", "correlation_id"])(
    "rejects when required field %s is missing",
    (field) => {
      const broken = structuredClone(validPayload) as Record<string, unknown>;
      delete broken[field];
      expect(PlatformEventSchema.safeParse(broken).success).toBe(false);
    },
  );
});

describe("RECOMMENDED_EVENT_TYPES", () => {
  it("is a non-empty reference list and every entry parses as a valid event_type", () => {
    expect(RECOMMENDED_EVENT_TYPES.length).toBeGreaterThan(0);
    for (const eventType of RECOMMENDED_EVENT_TYPES) {
      expect(PlatformEventSchema.safeParse({ ...validPayload, event_type: eventType }).success).toBe(true);
    }
  });
});
