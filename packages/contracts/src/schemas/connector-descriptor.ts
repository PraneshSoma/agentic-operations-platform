import { z } from "zod";

/**
 * ConnectorDescriptor — a registered connector, read or write (spec §10).
 * supports_correlation/is_idempotent (LLD-v1 §2, ADR-004) apply to action
 * (write) connectors — declared at registration, not assumed. reliability_level
 * (ADR-007) is keyed to this exact (tenant, connector, version) row, not a
 * global per-type default — ordinal, never a decimal implying false precision.
 */
export const ConnectorDescriptorSchema = z.object({
  connector_id: z.string(),
  tenant_id: z.string(),
  type: z.enum(["logs", "metrics", "database", "api", "knowledge"]),

  operations: z.array(
    z.object({
      name: z.string(),
      input_schema: z.record(z.string(), z.unknown()),
      output_schema: z.record(z.string(), z.unknown()),
    }),
  ),

  authorization: z.object({
    mode: z.enum(["oauth", "api_key", "service_account", "custom"]),
    secret_ref: z.string(),
  }),

  scopes: z.object({
    environments: z.array(z.string()),
    applications: z.array(z.string()),
  }),

  staleness: z.object({
    max_age_seconds: z.number().int(),
    on_exceeded: z.enum(["MARK_STALE", "REFETCH", "FAIL"]),
  }),

  // Additive — LLD-v1 §2, OI-REQ-10, ADR-004, ADR-007.
  definition_version: z.string(),
  supports_correlation: z.boolean().default(false),
  is_idempotent: z.boolean().default(false),
  reliability_level: z.enum(["LOW", "MEDIUM", "HIGH", "AUTHORITATIVE"]),
});

export type ConnectorDescriptor = z.infer<typeof ConnectorDescriptorSchema>;
