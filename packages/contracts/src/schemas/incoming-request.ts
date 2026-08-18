import { z } from "zod";

/**
 * IncomingRequest — normalized representation of any incoming operational
 * work (spec §4.1). Every trigger adapter (Slack, webhook, ...) produces
 * one of these; downstream components consume only this normalized shape,
 * never trigger-specific fields (spec §4.1 Rules).
 */
export const IncomingRequestSchema = z.object({
  request_id: z.string(),
  tenant_id: z.string(),

  source: z.object({
    type: z.enum(["slack", "servicenow", "pagerduty", "email", "webhook"]),
    source_id: z.string(),
    source_reference: z.string(),
  }),

  received_at: z.string().datetime(),

  requester: z.object({
    id: z.string(),
    display_name: z.string().optional(),
    roles: z.array(z.string()),
  }),

  subject: z.string(),
  description: z.string(),

  labels: z.object({
    severity: z.string().optional(),
    application: z.string().optional(),
    environment: z.string().optional(),
    category: z.string().optional(),
  }),

  // Reference into raw-payload storage, never the raw payload itself.
  raw_payload_ref: z.string(),

  correlation: z.object({
    incident_id: z.string().optional(),
    ticket_id: z.string().optional(),
    conversation_id: z.string().optional(),
  }),
});

export type IncomingRequest = z.infer<typeof IncomingRequestSchema>;
