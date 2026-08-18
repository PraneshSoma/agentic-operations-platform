import { describe, expect, it } from "vitest";
import { ResolutionPlanSchema } from "./resolution-plan.js";

const validPayload = {
  plan_id: "plan_1",
  diagnosis_ref: "diag_1",
  steps: [
    { step_id: "step_1", type: "READ", description: "confirm current deployment version" },
    { step_id: "step_2", type: "ACTION", description: "restart the service", action_ref: "restart_service", parameters: { service: "checkout" } },
    { step_id: "step_3", type: "VERIFY", description: "confirm error rate recovers" },
  ],
  expected_outcome: "error rate returns to baseline",
  rollback_strategy: "redeploy previous version",
  unresolved_risks: [],
};

describe("ResolutionPlanSchema", () => {
  it("accepts a valid payload matching spec §12's shape", () => {
    expect(ResolutionPlanSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts a step with no action_ref/parameters (READ/VERIFY steps)", () => {
    const readOnly = { ...validPayload, steps: [{ step_id: "step_1", type: "READ", description: "x" }] };
    expect(ResolutionPlanSchema.safeParse(readOnly).success).toBe(true);
  });

  it("accepts an omitted rollback_strategy", () => {
    const { rollback_strategy: _omit, ...withoutRollback } = validPayload;
    expect(ResolutionPlanSchema.safeParse(withoutRollback).success).toBe(true);
  });

  it("rejects an out-of-enum step type", () => {
    const broken = { ...validPayload, steps: [{ step_id: "step_1", type: "DELETE_EVERYTHING", description: "x" }] };
    expect(ResolutionPlanSchema.safeParse(broken).success).toBe(false);
  });

  it.each(["plan_id", "diagnosis_ref", "steps", "expected_outcome", "unresolved_risks"])(
    "rejects when required top-level field %s is missing",
    (field) => {
      const broken = structuredClone(validPayload) as Record<string, unknown>;
      delete broken[field];
      expect(ResolutionPlanSchema.safeParse(broken).success).toBe(false);
    },
  );
});
