import { describe, expect, it } from "vitest";
import { ConnectorDescriptorSchema } from "./connector-descriptor.js";

const validPayload = {
  connector_id: "logs-connector",
  tenant_id: "tenant_abc",
  type: "logs",
  operations: [{ name: "query", input_schema: {}, output_schema: {} }],
  authorization: { mode: "api_key", secret_ref: "secret://logs-connector-key" },
  scopes: { environments: ["prod"], applications: ["checkout-service"] },
  staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" },
  definition_version: "1.0.0",
  reliability_level: "HIGH",
};

describe("ConnectorDescriptorSchema", () => {
  it("accepts a valid payload matching spec §10's shape, including the additive LLD-v1 §2 fields", () => {
    expect(ConnectorDescriptorSchema.safeParse(validPayload).success).toBe(true);
  });

  it("defaults supports_correlation and is_idempotent to false when omitted", () => {
    const parsed = ConnectorDescriptorSchema.parse(validPayload);
    expect(parsed.supports_correlation).toBe(false);
    expect(parsed.is_idempotent).toBe(false);
  });

  it("CRITICAL: rejects an out-of-enum reliability_level value — must be one of the 4 ordinal levels (ADR-007), never a decimal implying false precision", () => {
    const broken = { ...validPayload, reliability_level: 0.83 };
    expect(ConnectorDescriptorSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum connector type", () => {
    expect(ConnectorDescriptorSchema.safeParse({ ...validPayload, type: "vibes" }).success).toBe(false);
  });

  it("rejects an out-of-enum staleness.on_exceeded value", () => {
    const broken = { ...validPayload, staleness: { ...validPayload.staleness, on_exceeded: "IGNORE" } };
    expect(ConnectorDescriptorSchema.safeParse(broken).success).toBe(false);
  });
});
