import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { IdentityResolver } from "@aop/identity";
import { runApprovalAcceptanceGate } from "@aop/policy-engine";
import type { ApprovalContextStore } from "../approvals/approval-context-store.js";

const BodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "REQUEST_CHANGES", "EXPIRED"]),
  actor_ref: z.string(),
  comment: z.string().optional(),
});

export interface ApprovalRoutesOptions {
  approvalContextStore: ApprovalContextStore;
  identityResolver: IdentityResolver;
}

/**
 * POST /tenants/{tenantId}/approvals/{approvalId}/decision — LLD-v1 §6
 * (story C-04). Resolves actor_ref via IdentityResolver, runs the
 * separation-of-duties check when
 * PolicyDecision.requires_proposer_approver_separation is true, issues
 * ExecutionAuthorization only if every check in runApprovalAcceptanceGate
 * passes.
 *
 * :tenantId/:approvalId aren't re-validated with a Zod schema here, for
 * the same reason B-01's webhook route doesn't re-validate :tenantId:
 * Fastify's own router already requires a non-empty path segment to
 * match at all, so a param-shape check would be unreachable dead code.
 */
export async function registerApprovalRoutes(app: FastifyInstance, options: ApprovalRoutesOptions): Promise<void> {
  app.post<{ Params: { tenantId: string; approvalId: string } }>(
    "/tenants/:tenantId/approvals/:approvalId/decision",
    async (request, reply) => {
      const body = BodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid request body" });
      }

      const { tenantId, approvalId } = request.params;
      const context = await options.approvalContextStore.get(tenantId, approvalId);
      if (!context) {
        return reply.code(404).send({ error: `no approval found for approval_id "${approvalId}"` });
      }

      const result = await runApprovalAcceptanceGate({
        tenantId,
        policyDecision: context.policyDecision,
        proposedAction: context.proposedAction,
        decision: body.data.decision,
        actorId: body.data.actor_ref,
        identityResolver: options.identityResolver,
        now: new Date(),
        authorizationId: randomUUID(),
        signedPlanHash: `sha256:placeholder-${approvalId}`,
        issuedBy: "approval-acceptance-gate",
      });

      if (result.outcome === "AUTHORIZED") {
        return reply.code(200).send({ outcome: "AUTHORIZED", authorization_id: result.authorization.authorization_id });
      }

      return reply.code(403).send({ outcome: "REJECTED", reason: result.reason });
    },
  );
}
