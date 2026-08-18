import { z } from "zod";

/**
 * PlatformEvent (spec §22) — one event in the orchestrator's event stream.
 * Required by every ExecutionState transition (spec §7 "State transition
 * requirements": persist, emit, evidence, idempotent — CONTEXT.md RULE 7).
 *
 * event_type stays z.string() (spec-literal — the YAML types it `string`,
 * not an enum). RECOMMENDED_EVENT_TYPES below is the canonical reference
 * list from spec §22, exported as a plain array rather than a schema
 * constraint: new lifecycle points are expected to add new event types
 * over time (CONTEXT.md RULE 8 — additive, not a closed set), and an
 * unconstrained but well-known vocabulary serves that better than a
 * schema that has to be revised for every new one.
 */
export const PlatformEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  tenant_id: z.string(),
  request_id: z.string(),
  execution_id: z.string(),
  occurred_at: z.string().datetime(),
  payload_ref: z.string(),
  correlation_id: z.string(),
});

export type PlatformEvent = z.infer<typeof PlatformEventSchema>;

/** Spec §22's "Recommended events" list — a reference vocabulary, not an enforced enum. */
export const RECOMMENDED_EVENT_TYPES = [
  "request.received",
  "request.normalized",
  "opc.matched",
  "context.assembly.started",
  "context.assembly.completed",
  "investigation.completed",
  "diagnosis.completed",
  "plan.created",
  "action.proposed",
  "policy.evaluated",
  "approval.requested",
  "approval.decided",
  "execution.started",
  "execution.completed",
  "verification.completed",
  "rollback.started",
  "rollback.completed",
  "request.resolved",
  "request.escalated",
] as const;
