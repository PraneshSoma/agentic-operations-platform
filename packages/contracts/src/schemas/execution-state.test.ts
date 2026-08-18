import { describe, expect, it } from "vitest";
import { ExecutionStateSchema } from "./execution-state.js";

const validPayload = {
  execution_id: "exec_1",
  tenant_id: "tenant_abc",
  request_id: "req_1",
  opc_id: "opc_a",
  opc_version: "1.0.0",
  state: "INVESTIGATING",
  proposal_ids: [],
  retry_count: 0,
  budget_consumed: { investigation_tokens: 100, planning_tokens: 0, tool_calls: 2 },
  created_at: "2026-08-17T00:00:00.000Z",
  updated_at: "2026-08-17T00:00:00.000Z",
};

describe("ExecutionStateSchema", () => {
  it("accepts a valid payload matching spec §7's shape", () => {
    expect(ExecutionStateSchema.safeParse(validPayload).success).toBe(true);
  });

  it("CRITICAL: accepts EXECUTION_UNCERTAIN as a valid state — LLD-v1 §4/ADR-004's explicit representation of an unproven crash-recovery outcome", () => {
    const parsed = ExecutionStateSchema.safeParse({ ...validPayload, state: "EXECUTION_UNCERTAIN" });
    expect(parsed.success).toBe(true);
  });

  it("rejects an out-of-enum state value", () => {
    expect(ExecutionStateSchema.safeParse({ ...validPayload, state: "VIBING" }).success).toBe(false);
  });

  it.each(["execution_id", "tenant_id", "request_id", "opc_id", "opc_version", "state", "proposal_ids", "retry_count", "created_at", "updated_at"])(
    "rejects a payload missing required field %s",
    (field) => {
      const broken = { ...validPayload };
      delete (broken as Record<string, unknown>)[field];
      expect(ExecutionStateSchema.safeParse(broken).success).toBe(false);
    },
  );
});
