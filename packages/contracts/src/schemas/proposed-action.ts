import { z } from "zod";

/**
 * ProposedAction — an agent's proposal to mutate a production system,
 * subject to Policy Engine evaluation before any execution (spec §4.3,
 * §1.2). blast_radius carries five independently-scored components
 * (LLD-v1 §2, ADR-003) — never collapsed into one number.
 */
export const ProposedActionSchema = z.object({
  proposal_id: z.string(),
  request_id: z.string(),
  execution_id: z.string(),
  tenant_id: z.string(),

  action_ref: z.string(),
  action_version: z.string(),

  reason: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  expected_outcome: z.string(),

  risk_assessment: z.object({
    requested_risk_class: z.enum(["R0", "R1", "R2", "R3"]),

    blast_radius: z.object({
      scope: z.string(),
      estimated_entities: z.number().int().optional(),
      // Additive components beyond spec §4.3 — LLD-v1 §2, ADR-003.
      // Optional: not every action kind populates all five yet.
      environmental_criticality: z.string().optional(),
      compensation_class: z
        .enum(["REVERSIBLE", "COMPENSATABLE", "IRREVERSIBLE"])
        .optional(),
      data_sensitivity: z.string().optional(),
      customer_exposure: z.string().optional(),
    }),

    reversible: z.boolean(),
  }),

  supporting_evidence_ids: z.array(z.string()),

  generated_by: z.object({
    agent: z.string(),
    model: z.string(),
    prompt_version: z.string(),
  }),

  // Additive — LLD-v1 §5, ADR-012. The accountable human/system principal
  // this proposal was raised on behalf of, resolved via IdentityResolver.
  // Distinct from generated_by.agent/model, which names the AI agent.
  accountable_principal_id: z.string(),

  created_at: z.string().datetime(),
});

export type ProposedAction = z.infer<typeof ProposedActionSchema>;
