import { describe, expect, it } from "vitest";
import { IncomingRequestSchema } from "./incoming-request.js";

function omit<T extends object>(obj: T, path: string): T {
  const clone = structuredClone(obj);
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = clone;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]!];
  delete cur[parts[parts.length - 1]!];
  return clone;
}

const validPayload = {
  request_id: "req_123",
  tenant_id: "tenant_abc",
  source: { type: "webhook", source_id: "src_1", source_reference: "ref_1" },
  received_at: "2026-08-17T00:00:00.000Z",
  requester: { id: "user_1", display_name: "Jane Operator", roles: ["oncall"] },
  subject: "Checkout service errors",
  description: "Elevated 5xx rate on checkout-service",
  labels: {
    severity: "high",
    application: "checkout-service",
    environment: "prod",
    category: "error_spike",
  },
  raw_payload_ref: "s3://raw-payloads/req_123",
  correlation: { incident_id: "inc_1", ticket_id: "tick_1", conversation_id: "conv_1" },
};

describe("IncomingRequestSchema", () => {
  it("accepts a valid payload matching spec §4.1's shape", () => {
    expect(IncomingRequestSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts a payload with every optional field omitted", () => {
    const minimal = {
      request_id: "req_1",
      tenant_id: "tenant_1",
      source: { type: "webhook", source_id: "s", source_reference: "r" },
      received_at: "2026-08-17T00:00:00.000Z",
      requester: { id: "u", roles: [] },
      subject: "s",
      description: "d",
      labels: {},
      raw_payload_ref: "ref",
      correlation: {},
    };
    expect(IncomingRequestSchema.safeParse(minimal).success).toBe(true);
  });

  it.each([
    "request_id",
    "tenant_id",
    "source.type",
    "source.source_id",
    "source.source_reference",
    "received_at",
    "requester.id",
    "requester.roles",
    "subject",
    "description",
    "raw_payload_ref",
  ])("rejects a payload missing required field %s", (path) => {
    expect(IncomingRequestSchema.safeParse(omit(validPayload, path)).success).toBe(false);
  });

  it("CRITICAL: rejects an out-of-enum source.type value — a contract that silently accepts one defeats the deterministic runtime downstream (spec §1.1)", () => {
    const broken = { ...validPayload, source: { ...validPayload.source, type: "carrier_pigeon" } };
    expect(IncomingRequestSchema.safeParse(broken).success).toBe(false);
  });

  it("preserves raw_payload_ref as an opaque reference, never inlining trigger-specific payload shape (spec §4.1 Rules)", () => {
    const parsed = IncomingRequestSchema.parse(validPayload);
    expect(typeof parsed.raw_payload_ref).toBe("string");
  });
});
