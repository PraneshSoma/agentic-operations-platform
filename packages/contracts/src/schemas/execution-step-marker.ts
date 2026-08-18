import { z } from "zod";

/**
 * ExecutionStepMarker (LLD-v1 §2) — ADR-004's write-ahead marker, mirroring
 * the `execution_step_marker` table. `operation_id` is deterministically
 * derived (hash of tenant_id + execution_id + step_id + action_version,
 * see `deriveOperationId()` in @aop/action-executor) and reused across
 * every retry of the same logical operation — that stability is what
 * makes it a real idempotency key, not just a log entry.
 *
 * Completion transaction semantics (LLD-v1 §2): `status -> COMPLETED` is
 * written in the same transaction as the ExecutionState transition to
 * VERIFYING and the Evidence write — not a separate, untracked write.
 */
export const ExecutionStepMarkerSchema = z.object({
  marker_id: z.string(),
  tenant_id: z.string(),
  execution_id: z.string(),
  step_id: z.string(),
  operation_id: z.string(),

  action_ref: z.string(),
  action_version: z.string(),
  connector_ref: z.string(),
  connector_version: z.string(),

  // Increments on each retry of the SAME operation_id; starts at 1.
  attempt_number: z.number().int().min(1),
  status: z.enum(["ATTEMPTED", "COMPLETED"]),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
});

export type ExecutionStepMarker = z.infer<typeof ExecutionStepMarkerSchema>;
