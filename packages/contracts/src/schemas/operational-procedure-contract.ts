import { z } from "zod";

const RequiredContextEntrySchema = z.object({
  context_type: z.enum(["application", "runtime", "evidence"]),
  connector_ref: z.string(),
  operation: z.string(),
  required: z.boolean(),
  timeout_ms: z.number().int(),
});

const VerificationCheckSchema = z.object({
  name: z.string(),
  connector_ref: z.string(),
  operation: z.string(),
  success_condition: z.string(),
});

const EscalationConditionSchema = z.object({
  type: z.string(),
  threshold: z.unknown(),
});

/**
 * OperationalProcedureContract (OPC) — the declarative object governing one
 * class of operational work: required evidence, mandatory checks, permitted
 * actions, verification, escalation, and budget (spec §4.2). Must never
 * contain executable arbitrary code (spec §4.2 "Important").
 */
export const OperationalProcedureContractSchema = z.object({
  opc_id: z.string(),
  version: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "published", "retired"]),

  match: z.object({
    categories: z.array(z.string()),
    applications: z.array(z.string()),
    severities: z.array(z.string()),
    semantic_description: z.string().optional(),
  }),

  required_context: z.array(RequiredContextEntrySchema),

  investigation: z.object({
    objective: z.string(),
    required_checks: z.array(z.string()),
    max_hypotheses: z.number().int(),
  }),

  actions: z.object({
    allowed_action_refs: z.array(z.string()),
  }),

  verification: z.object({
    checks: z.array(VerificationCheckSchema),
  }),

  escalation: z.object({
    conditions: z.array(EscalationConditionSchema),
  }),

  rollback: z.object({
    required_for_risk_levels: z.array(z.enum(["R2", "R3"])),
    action_ref: z.string().optional(),
  }),

  timeout: z.object({
    investigation_minutes: z.number().int(),
    approval_minutes: z.number().int(),
    execution_minutes: z.number().int(),
  }),

  budget: z.object({
    max_investigation_tokens: z.number().int(),
    max_planning_tokens: z.number().int(),
    max_tool_calls: z.number().int(),
    max_wall_clock_minutes: z.number().int(),
    on_exceeded: z.enum(["ESCALATE", "STOP_AND_SUMMARIZE"]).default("ESCALATE"),
  }),
});

export type OperationalProcedureContract = z.infer<typeof OperationalProcedureContractSchema>;
export type RequiredContextEntry = z.infer<typeof RequiredContextEntrySchema>;
