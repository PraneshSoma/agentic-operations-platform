import { describe, expect, it } from "vitest";
import { HaltRequestSchema } from "./halt-request.js";

const valid = {
  actor: { id: "user_1", role: "senior_oncall" },
  scope: "single_execution",
  reason: "operator judgment call — pausing while investigating a related incident",
  created_at: "2026-08-18T12:00:00.000Z",
};

describe("HaltRequestSchema", () => {
  it("accepts a valid payload matching spec §7A's shape", () => {
    expect(HaltRequestSchema.safeParse(valid).success).toBe(true);
  });

  it.each(["single_execution", "all_tenant_executions"])("accepts scope %s", (scope) => {
    expect(HaltRequestSchema.safeParse({ ...valid, scope }).success).toBe(true);
  });

  it("rejects an out-of-enum scope value", () => {
    expect(HaltRequestSchema.safeParse({ ...valid, scope: "everything" }).success).toBe(false);
  });

  it.each(["actor", "scope", "reason", "created_at"])("rejects when required field %s is missing", (field) => {
    const broken = structuredClone(valid) as Record<string, unknown>;
    delete broken[field];
    expect(HaltRequestSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects when actor.id or actor.role is missing", () => {
    expect(HaltRequestSchema.safeParse({ ...valid, actor: { id: "user_1" } }).success).toBe(false);
    expect(HaltRequestSchema.safeParse({ ...valid, actor: { role: "senior_oncall" } }).success).toBe(false);
  });
});
