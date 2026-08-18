import { ExecutionAuthorizationSchema, type ExecutionAuthorization, type PolicyDecision, type ProposedAction } from "@aop/contracts";
import type { IdentityResolver } from "@aop/identity";

export interface ApprovalAcceptanceGateInput {
  tenantId: string;
  policyDecision: PolicyDecision;
  proposedAction: ProposedAction;
  decision: "APPROVED" | "REJECTED" | "REQUEST_CHANGES" | "EXPIRED";
  actorId: string;
  identityResolver: IdentityResolver;
  now: Date;
  authorizationId: string;
  signedPlanHash: string;
  issuedBy: string;
  /** Delegated tokens are short-lived (spec §14A) — default 15 minutes, overridable per tenant policy. */
  tokenTtlMinutes?: number;
}

export type ApprovalAcceptanceResult =
  | { outcome: "AUTHORIZED"; authorization: ExecutionAuthorization }
  | { outcome: "REJECTED"; reason: string };

/**
 * runApprovalAcceptanceGate — LLD-v1 §5's corrected sequence (story C-04):
 * resolves the candidate approver's identity via IdentityResolver AFTER
 * the PolicyDecision already exists — separation-of-duties is checked
 * HERE, against the actual resolved approver, never inside Policy
 * Engine Phase 2 (which cannot know who will approve before anyone has).
 *
 * No ExecutionAuthorization is issued until every check below passes, in
 * order — this is a hard precondition on the gate, not a warning (LLD-v1
 * §5): the PolicyDecision actually requires approval, the decision
 * itself is APPROVED (not REJECTED/REQUEST_CHANGES/EXPIRED), the actor
 * resolves to a real identity, that identity's roles permit the risk
 * class being approved, and — only when
 * PolicyDecision.requires_proposer_approver_separation is true — the
 * resolved approver is not the same principal who proposed the action.
 */
export async function runApprovalAcceptanceGate(input: ApprovalAcceptanceGateInput): Promise<ApprovalAcceptanceResult> {
  if (input.policyDecision.outcome !== "REQUIRE_APPROVAL") {
    return { outcome: "REJECTED", reason: `PolicyDecision outcome is ${input.policyDecision.outcome}, not REQUIRE_APPROVAL` };
  }

  if (input.decision !== "APPROVED") {
    return { outcome: "REJECTED", reason: `ApprovalDecision is ${input.decision}, not APPROVED` };
  }

  const approver = await input.identityResolver.resolve(input.tenantId, input.actorId);
  if (!approver) {
    return { outcome: "REJECTED", reason: `Could not resolve approver identity for actor "${input.actorId}"` };
  }

  if (!input.identityResolver.hasRiskClassApprovalPermission(approver, input.policyDecision.effective_risk_class)) {
    return {
      outcome: "REJECTED",
      reason: `Approver's roles do not permit approval of risk class ${input.policyDecision.effective_risk_class}`,
    };
  }

  if (input.policyDecision.requires_proposer_approver_separation && approver.id === input.proposedAction.accountable_principal_id) {
    return {
      outcome: "REJECTED",
      reason: "Separation of duties violated — approver is the same principal who proposed this action; route to a different approver",
    };
  }

  const ttlMinutes = input.tokenTtlMinutes ?? 15;
  const expiresAt = new Date(input.now.getTime() + ttlMinutes * 60 * 1000);

  const authorization = ExecutionAuthorizationSchema.parse({
    authorization_id: input.authorizationId,
    proposal_id: input.proposedAction.proposal_id,
    policy_decision_id: input.policyDecision.decision_id,
    identity: {
      mode: "ON_BEHALF_OF",
      acting_as: { id: approver.id, type: "human" },
      approver_ref: approver.id,
      requester_ref: input.proposedAction.accountable_principal_id,
    },
    delegation: {
      token_type: "none",
      scopes: [],
      issued_at: input.now.toISOString(),
      expires_at: expiresAt.toISOString(),
    },
    signed_plan_hash: input.signedPlanHash,
    issued_by: input.issuedBy,
    created_at: input.now.toISOString(),
  });

  return { outcome: "AUTHORIZED", authorization };
}
