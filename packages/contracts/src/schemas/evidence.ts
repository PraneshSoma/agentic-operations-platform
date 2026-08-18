import { z } from "zod";

/**
 * Evidence — one append-only record in the Evidence Ledger (spec §4.6,
 * §21). Corrections create a new record referencing the superseded one via
 * relationships.supersedes — never an in-place update. retention_class is
 * constrained to five named classes (LLD-v1 §2, ADR-011), each with its
 * own retention_expires_at, not a free string with no enforcement.
 */
export const EvidenceSchema = z.object({
  evidence_id: z.string(),
  tenant_id: z.string(),
  request_id: z.string(),
  execution_id: z.string(),

  type: z.enum([
    "REQUEST",
    "CONTEXT",
    "OBSERVATION",
    "HYPOTHESIS",
    "PLAN",
    "APPROVAL",
    "ACTION_RESULT",
    "VERIFICATION",
    "ROLLBACK",
    "OUTCOME",
  ]),

  source: z.object({
    component: z.string(),
    connector_ref: z.string().optional(),
    source_reference: z.string().optional(),
  }),

  content: z.object({
    summary: z.string(),
    structured_data: z.record(z.string(), z.unknown()).optional(),
  }),

  relationships: z.object({
    supports: z.array(z.string()).optional(),
    contradicts: z.array(z.string()).optional(),
    derived_from: z.array(z.string()).optional(),
    supersedes: z.string().optional(),
  }),

  integrity: z.object({
    created_at: z.string().datetime(),
    content_hash: z.string(),
  }),

  retention_class: z.enum([
    "operational_state",
    "prompts",
    "evidence_record",
    "secrets_redacted_payload",
    "audit_hash",
  ]),

  // Additive — LLD-v1 §2, ADR-011. A retention_class name alone doesn't
  // enforce anything; these three fields are what an actual deletion/
  // archival job runs against.
  retention_expires_at: z.string().datetime(),
  retention_policy_version: z.string(),
  legal_hold: z.boolean().default(false),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
