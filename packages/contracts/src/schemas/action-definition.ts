import { z } from "zod";

/**
 * ActionDefinition — a registered, versioned action (spec §13). The
 * compensation_class three-way split (LLD-v1 §2, ADR-001) is additive
 * alongside the spec-literal `reversible` boolean, never replacing it — see
 * RULE in ADR-001: reversible: true requires compensation_class: REVERSIBLE;
 * reversible: false requires COMPENSATABLE or IRREVERSIBLE. Enforced at
 * registration by ActionConnector.validateAction(), not by this schema
 * alone (Zod's cross-field refinement is used here for the same effect).
 */
export const ActionDefinitionSchema = z
  .object({
    action_id: z.string(),
    version: z.string(),
    tenant_id: z.string(),

    name: z.string(),
    description: z.string(),

    executor_connector_ref: z.string(),
    operation: z.string(),

    input_schema: z.record(z.string(), z.unknown()),

    default_risk_class: z.enum(["R0", "R1", "R2", "R3"]),

    blast_radius: z.object({
      scope: z.enum(["entity", "service", "environment", "multi_service"]),
    }),

    reversible: z.boolean(),
    rollback_action_ref: z.string().optional(),

    environment_constraints: z.object({
      allowed: z.array(z.enum(["dev", "test", "stage", "prod"])),
    }),

    policy_tags: z.array(z.string()),

    status: z.enum(["active", "disabled"]),

    // Additive — LLD-v1 §2, ADR-001/003.
    compensation_class: z.enum(["REVERSIBLE", "COMPENSATABLE", "IRREVERSIBLE"]),
    risk_scoring_ref: z.string().optional(),
  })
  .refine(
    (action) =>
      action.reversible
        ? action.compensation_class === "REVERSIBLE"
        : action.compensation_class === "COMPENSATABLE" || action.compensation_class === "IRREVERSIBLE",
    {
      message:
        "reversible and compensation_class are inconsistent — reversible: true requires " +
        "compensation_class: REVERSIBLE; reversible: false requires COMPENSATABLE or IRREVERSIBLE (ADR-001)",
      path: ["compensation_class"],
    },
  );

export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;
