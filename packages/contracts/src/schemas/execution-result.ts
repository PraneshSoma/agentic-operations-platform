import { z } from "zod";

/**
 * ExecutionResult — the outcome of one Action Executor run (spec §4.5).
 * executor_build_hash (LLD-v1 §0, OI-REQ-10) binds the result to the exact
 * executor build that produced it, for replayability.
 */
export const ExecutionResultSchema = z.object({
  execution_result_id: z.string(),
  proposal_id: z.string(),

  action_ref: z.string(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),

  status: z.enum(["SUCCESS", "FAILED", "PARTIAL", "TIMED_OUT"]),
  provider_reference: z.string().optional(),
  output_summary: z.string(),

  side_effects: z.object({
    entities_changed: z.number().int().optional(),
    systems_touched: z.array(z.string()),
  }),

  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
  }),

  rollback_available: z.boolean(),

  // Additive — LLD-v1 §0, OI-REQ-10. Populated from a build-time-injected
  // constant (container image's git SHA); never computed at runtime.
  executor_build_hash: z.string(),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
