import type { FastifyInstance } from "fastify";
import { StatusCheckRequestSchema } from "@aop/contracts";
import type { ActionConnector } from "@aop/action-executor";

export interface StatusCheckRoutesOptions {
  /** connector_ref -> the ActionConnector instance registered for it. */
  connectorRegistry: ReadonlyMap<string, ActionConnector>;
}

/**
 * POST /internal/connectors/{connector_ref}/status-check — LLD-v1 §6
 * (story D-07). Internal, orchestrator-to-connector — not tenant-facing,
 * no tenant_id in the path (a status check is scoped by connector_ref +
 * operation_id, not by tenant, matching the LLD's own contract shape).
 *
 * Delegates straight to the resolved connector's own `statusCheck()`
 * (ADR-004) — this route is a thin HTTP surface over the same interface
 * method `recoverUncertainExecution()` calls in-process; it exists
 * because LLD-v1 §6 names this exact HTTP contract explicitly, not
 * because the orchestrator itself needs to go over HTTP to reach a
 * connector it already holds a reference to.
 */
export async function registerStatusCheckRoutes(app: FastifyInstance, options: StatusCheckRoutesOptions): Promise<void> {
  app.post<{ Params: { connector_ref: string } }>("/internal/connectors/:connector_ref/status-check", async (request, reply) => {
    const body = StatusCheckRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid request body" });
    }

    const { connector_ref } = request.params;
    const connector = options.connectorRegistry.get(connector_ref);
    if (!connector) {
      return reply.code(404).send({ error: `no connector registered for connector_ref "${connector_ref}"` });
    }

    const result = await connector.statusCheck(body.data.operation_id, body.data.action_version, body.data.connector_version);
    return reply.code(200).send(result);
  });
}
