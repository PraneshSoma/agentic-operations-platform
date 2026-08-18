import { randomUUID } from "node:crypto";
import { IncomingRequestSchema, type IncomingRequest } from "@aop/contracts";
import type { RawPayloadStore } from "./raw-payload-store.js";

/**
 * The shape a webhook POST body is expected to loosely carry. Deliberately
 * permissive (`z.unknown()`/`.optional()` almost everywhere) — a generic
 * webhook adapter cannot assume a specific upstream system's schema; it
 * only needs enough structure to fill IncomingRequest's normalized shape.
 * Anything this shape doesn't name is trigger-specific noise that must
 * never reach past this adapter (spec §4.1 Rules) — it lives only in the
 * raw payload, addressed later solely via raw_payload_ref.
 */
export interface WebhookTriggerPayload {
  source_id?: string;
  source_reference?: string;
  requester?: { id: string; display_name?: string; roles?: string[] };
  subject?: string;
  description?: string;
  labels?: {
    severity?: string;
    application?: string;
    environment?: string;
    category?: string;
  };
  correlation?: {
    incident_id?: string;
    ticket_id?: string;
    conversation_id?: string;
  };
  // Anything else on the raw body (signatures, provider-specific envelope
  // fields, etc.) is intentionally NOT part of this interface — it stays
  // in the raw payload only, never read by this adapter into the
  // normalized IncomingRequest.
  [key: string]: unknown;
}

export interface NormalizeWebhookRequestInput {
  tenantId: string;
  payload: WebhookTriggerPayload;
  rawPayloadStore: RawPayloadStore;
  now?: Date;
}

/**
 * Webhook trigger adapter (spec §4.1, story B-01, F-01 MVP). Normalizes a
 * webhook POST body into a schema-valid IncomingRequest and preserves the
 * raw payload separately via RawPayloadStore — the returned IncomingRequest
 * never carries the raw body, only a `raw_payload_ref` pointing at it.
 *
 * `IncomingRequestSchema.parse()` at the return boundary (CONTEXT.md
 * RULE 1) is also what enforces "no trigger-specific field readable
 * outside the trigger adapter" — Zod strips any key not in the schema, so
 * even if this function accidentally spread extra webhook-specific fields
 * onto the object before returning, they would not survive the parse.
 */
export async function normalizeWebhookRequest(input: NormalizeWebhookRequestInput): Promise<IncomingRequest> {
  const { tenantId, payload, rawPayloadStore, now = new Date() } = input;

  const raw_payload_ref = await rawPayloadStore.store(tenantId, payload);

  const candidate = {
    request_id: randomUUID(),
    tenant_id: tenantId,

    source: {
      type: "webhook" as const,
      source_id: payload.source_id ?? "unknown",
      source_reference: payload.source_reference ?? "unknown",
    },

    received_at: now.toISOString(),

    requester: {
      id: payload.requester?.id ?? "unknown",
      display_name: payload.requester?.display_name,
      roles: payload.requester?.roles ?? [],
    },

    subject: payload.subject ?? "(no subject provided)",
    description: payload.description ?? "(no description provided)",

    labels: {
      severity: payload.labels?.severity,
      application: payload.labels?.application,
      environment: payload.labels?.environment,
      category: payload.labels?.category,
    },

    raw_payload_ref,

    correlation: {
      incident_id: payload.correlation?.incident_id,
      ticket_id: payload.correlation?.ticket_id,
      conversation_id: payload.correlation?.conversation_id,
    },
  };

  return IncomingRequestSchema.parse(candidate);
}
