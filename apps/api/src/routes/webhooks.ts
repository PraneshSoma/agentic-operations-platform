import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeWebhookRequest, type WebhookTriggerPayload } from "../triggers/webhook-adapter.js";
import type { RawPayloadStore } from "../triggers/raw-payload-store.js";

// Deliberately loose — see WebhookTriggerPayload's own comment. This is
// only "is it a JSON object at all"; IncomingRequestSchema.parse() inside
// the adapter is the real, authoritative validation of the normalized
// output (CONTEXT.md RULE 1).
const BodySchema = z.record(z.string(), z.unknown());

export interface WebhookRoutesOptions {
  rawPayloadStore: RawPayloadStore;
}

/**
 * POST /webhooks/:tenantId — spec §4.1, story B-01. Accepts any JSON body
 * from a webhook source, normalizes it into a schema-valid IncomingRequest
 * via the trigger adapter, and returns only the normalized request_id/
 * received_at — never the raw body, never the full IncomingRequest (this
 * route is a trigger endpoint, not the orchestrator's ingestion API; the
 * orchestrator picks up the normalized IncomingRequest independently —
 * that hand-off is B-03's job).
 *
 * :tenantId isn't re-validated with a Zod schema here: Fastify's own
 * router already requires a non-empty path segment to match `:tenantId`
 * at all, so a param-shape check here would be unreachable dead code, not
 * real validation.
 */
export async function registerWebhookRoutes(app: FastifyInstance, options: WebhookRoutesOptions): Promise<void> {
  app.post<{ Params: { tenantId: string } }>("/webhooks/:tenantId", async (request, reply) => {
    const body = BodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "request body must be a JSON object" });
    }

    const { tenantId } = request.params;
    const incomingRequest = await normalizeWebhookRequest({
      tenantId,
      payload: body.data as WebhookTriggerPayload,
      rawPayloadStore: options.rawPayloadStore,
    });

    // Story B-01's scope ends at producing a schema-valid IncomingRequest.
    // Handing it to the durable orchestrator (BullMQ enqueue) is B-03.
    request.log.info({ request_id: incomingRequest.request_id, tenant_id: tenantId }, "normalized incoming request");

    return reply.code(202).send({
      request_id: incomingRequest.request_id,
      received_at: incomingRequest.received_at,
    });
  });
}
