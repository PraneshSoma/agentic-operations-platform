import type { FastifyInstance } from "fastify";
import { evaluateActivation, type TenantActivationRepository } from "@aop/evidence-ledger";

export interface OnboardingRoutesOptions {
  tenantActivationRepository: TenantActivationRepository;
}

/**
 * Tenant activation gate (story E-07, LLD-v1 §6). A REAL technical gate,
 * not documentation: POST /tenants/:tenantId/onboarding/activate stamps
 * `production_activated_at` ONLY when the unified ADR-011 + ADR-012 gate
 * passes — retention decision recorded AND no development principal in
 * the tenant's roster. Otherwise it returns 409 with the concrete
 * rejection reasons and stamps nothing.
 */
export async function registerOnboardingRoutes(app: FastifyInstance, options: OnboardingRoutesOptions): Promise<void> {
  app.post<{ Params: { tenantId: string } }>("/tenants/:tenantId/onboarding/activate", async (request, reply) => {
    const { tenantId } = request.params;
    const state = await options.tenantActivationRepository.getActivationState(tenantId);

    if (!state.exists) {
      return reply.code(404).send({ error: `no tenant "${tenantId}"` });
    }

    // Idempotent: an already-activated tenant returns its existing stamp.
    if (state.productionActivatedAt) {
      return reply.code(200).send({ outcome: "ALREADY_ACTIVATED", production_activated_at: state.productionActivatedAt });
    }

    const decision = evaluateActivation({
      retentionPolicyConfirmedAt: state.retentionPolicyConfirmedAt,
      developmentPrincipalIds: state.developmentPrincipalIds,
    });

    if (decision.outcome === "REJECTED") {
      return reply.code(409).send({ outcome: "REJECTED", reasons: decision.reasons });
    }

    const activatedAt = await options.tenantActivationRepository.markActivated(tenantId, new Date());
    return reply.code(200).send({ outcome: "ACTIVATED", production_activated_at: activatedAt });
  });
}
