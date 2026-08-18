import { describe, expect, it } from "vitest";
import { StatusCheckRequestSchema, StatusCheckResultSchema } from "./status-check.js";

describe("StatusCheckRequestSchema", () => {
  const valid = { operation_id: "op_abc123", action_version: "1.0.0", connector_version: "1.0.0" };

  it("accepts a valid payload matching LLD-v1 §6's shape", () => {
    expect(StatusCheckRequestSchema.safeParse(valid).success).toBe(true);
  });

  it.each(["operation_id", "action_version", "connector_version"])("rejects when required field %s is missing", (field) => {
    const broken = structuredClone(valid) as Record<string, unknown>;
    delete broken[field];
    expect(StatusCheckRequestSchema.safeParse(broken).success).toBe(false);
  });
});

describe("StatusCheckResultSchema", () => {
  it.each(["CONFIRMED_EXECUTED", "CONFIRMED_NOT_EXECUTED", "INCONCLUSIVE"])("accepts outcome %s", (outcome) => {
    expect(StatusCheckResultSchema.safeParse({ outcome }).success).toBe(true);
  });

  it("accepts an optional detail string", () => {
    expect(StatusCheckResultSchema.safeParse({ outcome: "INCONCLUSIVE", detail: "connector timed out" }).success).toBe(true);
  });

  it("rejects an out-of-enum outcome value", () => {
    expect(StatusCheckResultSchema.safeParse({ outcome: "MAYBE" }).success).toBe(false);
  });

  it("rejects when outcome is missing", () => {
    expect(StatusCheckResultSchema.safeParse({}).success).toBe(false);
  });
});
