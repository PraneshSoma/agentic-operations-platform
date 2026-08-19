import type { FastifyInstance } from "fastify";
import type { ControlTowerRepository } from "@aop/evidence-ledger";

export interface ControlTowerRoutesOptions {
  controlTowerRepository: ControlTowerRepository;
}

/**
 * Control Tower minimal read API (story E-05, F-16, OI-REQ-02, LLD-v1 §6).
 *
 * - GET /tenants/:tenantId/executions/:executionId/context-package/composite
 *     — the read-only EngineeringContextPackageView (OI-REQ-02): a
 *       read-time join by execution_id, zero ContextPackage schema change.
 * - GET /tenants/:tenantId/executions/:executionId/history
 *     — the execution's complete history reconstructed from Evidence
 *       Ledger records alone (spec §34's named acceptance bar).
 *
 * Both are tenant-scoped by path and by the repository's own tenant
 * filter; a wrong-tenant or unknown execution returns 404, never another
 * tenant's data.
 */
export async function registerControlTowerRoutes(app: FastifyInstance, options: ControlTowerRoutesOptions): Promise<void> {
  app.get<{ Params: { tenantId: string; executionId: string } }>(
    "/tenants/:tenantId/executions/:executionId/context-package/composite",
    async (request, reply) => {
      const { tenantId, executionId } = request.params;
      const view = await options.controlTowerRepository.getCompositeContextPackage(tenantId, executionId);
      if (!view) {
        return reply.code(404).send({ error: `no execution "${executionId}" for tenant "${tenantId}"` });
      }
      return reply.code(200).send(view);
    },
  );

  app.get<{ Params: { tenantId: string; executionId: string } }>(
    "/tenants/:tenantId/executions/:executionId/history",
    async (request, reply) => {
      const { tenantId, executionId } = request.params;
      const history = await options.controlTowerRepository.reconstructExecutionHistory(tenantId, executionId);
      if (!history) {
        return reply.code(404).send({ error: `no execution "${executionId}" for tenant "${tenantId}"` });
      }
      return reply.code(200).send(history);
    },
  );
}
