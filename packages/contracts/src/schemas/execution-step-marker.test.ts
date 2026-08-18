import { describe, expect, it } from "vitest";
import { ExecutionStepMarkerSchema } from "./execution-step-marker.js";

const valid = {
  marker_id: "marker_1",
  tenant_id: "tenant_1",
  execution_id: "exec_1",
  step_id: "step_1",
  operation_id: "op_abc123",
  action_ref: "restart_service",
  action_version: "1.0.0",
  connector_ref: "sim-action-connector",
  connector_version: "1.0.0",
  attempt_number: 1,
  status: "ATTEMPTED",
  created_at: "2026-08-18T12:00:00.000Z",
  updated_at: "2026-08-18T12:00:00.000Z",
};

describe("ExecutionStepMarkerSchema", () => {
  it("accepts a valid ATTEMPTED marker matching LLD-v1 §2's shape", () => {
    expect(ExecutionStepMarkerSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a COMPLETED marker with completed_at set", () => {
    expect(ExecutionStepMarkerSchema.safeParse({ ...valid, status: "COMPLETED", completed_at: valid.updated_at }).success).toBe(true);
  });

  it("accepts an omitted completed_at", () => {
    expect(ExecutionStepMarkerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects attempt_number less than 1", () => {
    expect(ExecutionStepMarkerSchema.safeParse({ ...valid, attempt_number: 0 }).success).toBe(false);
  });

  it("rejects a non-integer attempt_number", () => {
    expect(ExecutionStepMarkerSchema.safeParse({ ...valid, attempt_number: 1.5 }).success).toBe(false);
  });

  it("rejects an out-of-enum status value", () => {
    expect(ExecutionStepMarkerSchema.safeParse({ ...valid, status: "IN_PROGRESS" }).success).toBe(false);
  });

  it.each([
    "marker_id",
    "tenant_id",
    "execution_id",
    "step_id",
    "operation_id",
    "action_ref",
    "action_version",
    "connector_ref",
    "connector_version",
    "attempt_number",
    "status",
    "created_at",
    "updated_at",
  ])("rejects when required field %s is missing", (field) => {
    const broken = structuredClone(valid) as Record<string, unknown>;
    delete broken[field];
    expect(ExecutionStepMarkerSchema.safeParse(broken).success).toBe(false);
  });
});
