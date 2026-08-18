import { z } from "zod";

/**
 * ApprovalRequest / ApprovalDecision (spec §18) — the Approval Service.
 * LLD-v1 §6 references "the existing §18 approval shape... unchanged
 * from spec — referenced, not restated," which presupposes these
 * contracts exist; they didn't yet, same kind of gap every prior story
 * this session has caught (VerificationResult, PlatformEvent,
 * InvestigationResult, ResolutionPlan, IdentityPrincipal, PolicyRule).
 */
export const ApprovalRequestSchema = z.object({
  approval_id: z.string(),
  tenant_id: z.string(),
  request_id: z.string(),
  plan_id: z.string(),
  proposal_id: z.string(),

  approver_route: z.string(),

  summary: z.object({
    diagnosis: z.string(),
    proposed_action: z.string(),
    expected_outcome: z.string(),
    blast_radius: z.string(),
    rollback: z.string(),
  }),

  supporting_evidence_ids: z.array(z.string()),

  expires_at: z.string().datetime(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionSchema = z.object({
  approval_id: z.string(),
  decision: z.enum(["APPROVED", "REJECTED", "REQUEST_CHANGES", "EXPIRED"]),
  actor: z.object({
    id: z.string(),
    role: z.string(),
  }),
  comment: z.string().optional(),
  decided_at: z.string().datetime(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
