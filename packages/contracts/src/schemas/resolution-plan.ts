import { z } from "zod";

/**
 * ResolutionPlan (spec §12) — the Planner Agent's output. Once a human
 * approves a plan, the Frozen Plan Rule applies (spec §12, enforced by
 * packages/action-executor/src/frozen-plan-guard.ts, story B-06):
 * approved mutation steps are frozen, the executor cannot add or
 * substitute actions, and changed parameters require re-approval.
 */
export const ResolutionPlanStepSchema = z.object({
  step_id: z.string(),
  type: z.enum(["READ", "ACTION", "VERIFY"]),
  description: z.string(),
  action_ref: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

export const ResolutionPlanSchema = z.object({
  plan_id: z.string(),
  diagnosis_ref: z.string(),
  steps: z.array(ResolutionPlanStepSchema),
  expected_outcome: z.string(),
  rollback_strategy: z.string().optional(),
  unresolved_risks: z.array(z.string()),
});

export type ResolutionPlanStep = z.infer<typeof ResolutionPlanStepSchema>;
export type ResolutionPlan = z.infer<typeof ResolutionPlanSchema>;
