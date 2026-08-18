import { describe, expect, it } from "vitest";
import { PreconditionSetSchema, PreflightResultSchema } from "./preflight-result.js";

describe("PreconditionSetSchema", () => {
  it("accepts a valid payload matching spec §14B's shape", () => {
    const valid = {
      checks: [{ field_ref: "runtime_context.deployment_state.version", expected_value: "1.2.3", tolerance: "exact" }],
    };
    expect(PreconditionSetSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an out-of-enum tolerance value", () => {
    const broken = { checks: [{ field_ref: "x", expected_value: "y", tolerance: "close_enough" }] };
    expect(PreconditionSetSchema.safeParse(broken).success).toBe(false);
  });
});

describe("PreflightResultSchema", () => {
  it("accepts a MATCH result with no drifted fields", () => {
    expect(PreflightResultSchema.safeParse({ status: "MATCH", drifted_fields: [] }).success).toBe(true);
  });

  it("accepts a DRIFTED result with drifted_fields populated", () => {
    const drifted = {
      status: "DRIFTED",
      drifted_fields: [{ field_ref: "runtime_context.deployment_state.version", expected: "1.2.3", observed: "1.2.4" }],
    };
    expect(PreflightResultSchema.safeParse(drifted).success).toBe(true);
  });

  it("CRITICAL: accepts UNKNOWN as a valid status — spec §14B requires this be treated as missing context, never an implicit pass, so it must be a real, representable outcome", () => {
    const unknown = PreflightResultSchema.safeParse({ status: "UNKNOWN", drifted_fields: [] });
    expect(unknown.success).toBe(true);
  });

  it("rejects an out-of-enum status value", () => {
    expect(PreflightResultSchema.safeParse({ status: "PROBABLY_FINE", drifted_fields: [] }).success).toBe(false);
  });
});
