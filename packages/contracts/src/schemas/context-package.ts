import { z } from "zod";

const DependencySchema = z.object({
  name: z.string(),
  type: z.string().optional(),
});

const ApplicationContextSchema = z.object({
  application_id: z.string(),
  name: z.string(),
  owners: z.array(z.string()),
  environments: z.array(z.string()),
  dependencies: z.object({
    upstream: z.array(DependencySchema),
    downstream: z.array(DependencySchema),
  }),
  apis: z.array(z.object({ name: z.string(), endpoint_ref: z.string() })),
  datastores: z.array(z.object({ name: z.string(), type: z.string() })),
  messaging: z.array(z.object({ name: z.string(), type: z.enum(["topic", "queue"]) })),
  slo_refs: z.array(z.string()),
  approved_action_refs: z.array(z.string()),
  change_context: z.object({
    last_deployed_version: z.string().optional(),
    last_deployed_at: z.string().datetime().optional(),
    recent_change_ids: z.array(z.string()).optional(),
    change_owner: z.string().optional(),
  }),
});

const RuntimeContextSchema = z.object({
  time_window: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  logs: z.object({ summaries: z.array(z.string()), evidence_refs: z.array(z.string()) }),
  metrics: z.array(
    z.object({
      metric: z.string(),
      current: z.number(),
      baseline: z.number().optional(),
      anomaly: z.boolean(),
    }),
  ),
  traces: z.object({ summaries: z.array(z.string()) }),
  deployment_state: z.object({
    version: z.string().optional(),
    deployed_at: z.string().datetime().optional(),
  }),
});

const HistoricalEvidenceContextSchema = z.object({
  similar_cases: z.array(
    z.object({
      prior_request_id: z.string(),
      similarity: z.number(),
      diagnosis: z.string(),
      action_ref: z.string().optional(),
      outcome: z.string(),
      rollback: z.boolean(),
    }),
  ),
  aggregate: z.object({
    precedent_count: z.number().int(),
    verified_success_count: z.number().int(),
    failure_count: z.number().int(),
    rollback_count: z.number().int(),
  }),
});

/**
 * ContextPackage — the bounded, immutable-once-supplied context bundle the
 * Investigator reasons over (spec §8-9). stale_context (spec §10) surfaces
 * exactly which sources were outside their staleness tolerance, so a human
 * reviewer sees it explicitly rather than it being an internal-only flag.
 */
export const ContextPackageSchema = z.object({
  context_package_id: z.string(),
  tenant_id: z.string(),
  request_id: z.string(),
  opc_id: z.string(),

  assembled_at: z.string().datetime(),

  application_context: ApplicationContextSchema,
  runtime_context: RuntimeContextSchema,
  historical_evidence: HistoricalEvidenceContextSchema,

  missing_context: z.array(
    z.object({ source: z.string(), reason: z.string(), required: z.boolean() }),
  ),

  // Additive sibling to missing_context, per spec §10's staleness note.
  stale_context: z.array(
    z.object({
      source: z.string(),
      age_seconds: z.number().int(),
      max_age_seconds: z.number().int(),
    }),
  ),

  provenance: z.array(
    z.object({
      connector_ref: z.string(),
      query_ref: z.string(),
      retrieved_at: z.string().datetime(),
    }),
  ),
});

export type ContextPackage = z.infer<typeof ContextPackageSchema>;
export type ApplicationContext = z.infer<typeof ApplicationContextSchema>;
export type RuntimeContext = z.infer<typeof RuntimeContextSchema>;
export type HistoricalEvidenceContext = z.infer<typeof HistoricalEvidenceContextSchema>;
