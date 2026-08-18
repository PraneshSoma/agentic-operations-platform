import { describe, expect, it } from "vitest";
import { ExecutionResultSchema } from "./execution-result.js";

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
  execution_result_id: "res_1",
  proposal_id: "prop_1",
  action_ref: "restart_service",
  started_at: "2026-08-17T00:00:00.000Z",
  completed_at: "2026-08-17T00:01:00.000Z",
  status: "SUCCESS",
  provider_reference: "provider_ref_1",
  output_summary: "Service restarted successfully",
  side_effects: { entities_changed: 1, systems_touched: ["checkout-service"] },
  error: {},
  rollback_available: true,
  executor_build_hash: "abc1234",
};

describe("ExecutionResultSchema", () => {
  it("accepts a valid payload matching spec §4.5's shape, including executor_build_hash (LLD-v1 §0, OI-REQ-10)", () => {
    expect(ExecutionResultSchema.safeParse(validPayload).success).toBe(true);
  });

  it.each([
    "execution_result_id",
    "proposal_id",
    "action_ref",
    "started_at",
    "completed_at",
    "status",
    "output_summary",
    "side_effects.systems_touched",
    "rollback_available",
    "executor_build_hash",
  ])("rejects a payload missing required field %s", (path) => {
    expect(ExecutionResultSchema.safeParse(omit(validPayload, path)).success).toBe(false);
  });

  it("CRITICAL: rejects an out-of-enum status value — downstream Verification/Rollback logic (spec §19-20) branches on exactly these four values", () => {
    const broken = { ...validPayload, status: "PROBABLY_FINE" };
    expect(ExecutionResultSchema.safeParse(broken).success).toBe(false);
  });

  it("accepts a FAILED result with error.code and error.message populated", () => {
    const failed = {
      ...validPayload,
      status: "FAILED",
      error: { code: "PROVIDER_TIMEOUT", message: "Upstream provider did not respond in time" },
      rollback_available: false,
    };
    expect(ExecutionResultSchema.safeParse(failed).success).toBe(true);
  });
});
