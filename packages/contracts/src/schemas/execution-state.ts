import { z } from "zod";

/**
 * ExecutionState — the durable orchestrator's state machine (spec §7).
 * EXECUTION_UNCERTAIN (LLD-v1 §4, ADR-004) sits between EXECUTING and
 * VERIFYING/FAILED — its only exits require a proof (a status-check result
 * or a positive idempotency proof), never a default/timeout fallback.
 */
export const ExecutionStateSchema = z.object({
  execution_id: z.string(),
  tenant_id: z.string(),
  request_id: z.string(),

  opc_id: z.string(),
  opc_version: z.string(),

  state: z.enum([
    "RECEIVED",
    "OPC_MATCHED",
    "CONTEXT_ASSEMBLY",
    "INVESTIGATING",
    "DIAGNOSED",
    "PLANNED",
    "WAITING_APPROVAL",
    "EXECUTING",
    "EXECUTION_UNCERTAIN", // additive — LLD-v1 §4, ADR-004
    "VERIFYING",
    "ROLLING_BACK",
    "RESOLVED",
    "ESCALATED",
    "ESCALATED_HUMAN_OVERRIDE",
    "FAILED",
  ]),

  context_package_ref: z.string().optional(),
  proposal_ids: z.array(z.string()),
  current_proposal_id: z.string().optional(),
  retry_count: z.number().int(),

  budget_consumed: z.object({
    investigation_tokens: z.number().int(),
    planning_tokens: z.number().int(),
    tool_calls: z.number().int(),
  }),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type ExecutionState = z.infer<typeof ExecutionStateSchema>;
