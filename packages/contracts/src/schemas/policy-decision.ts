import { z } from "zod";

const PolicyReasonSchema = z.object({
  rule_id: z.string(),
  explanation: z.string(),
});

/**
 * Exported (story C-03): packages/policy-engine's hard-deny checks
 * (src/hard-deny.ts) need this as a standalone type — each check's `code`
 * field is one of these 8 values. Previously inlined only inside
 * PolicyDecisionSchema; same values, just now also independently
 * reusable. Additive — no value changed.
 */
export const HardDenyReasonCodeSchema = z.enum([
  "UNREGISTERED_ACTION",
  "TENANT_MISMATCH",
  "EXPIRED_AUTHORIZATION",
  "PROHIBITED_ENVIRONMENT",
  "MISSING_REQUIRED_EVIDENCE",
  "KILL_SWITCH_ACTIVE",
  "IMMUTABLE_POLICY_VIOLATION",
  "POLICY_EVALUATION_FAILED",
]);
export type HardDenyReasonCode = z.infer<typeof HardDenyReasonCodeSchema>;

/**
 * PolicyDecision — the Policy Engine's deterministic evaluation of one
 * ProposedAction (spec §4.4, §16). outcome is three-valued and DENY is
 * first-class: a hard-deny (LLD-v1 §3, ADR-008) is never presented as
 * merely "low confidence."
 */
export const PolicyDecisionSchema = z.object({
  decision_id: z.string(),
  proposal_id: z.string(),

  policy_version: z.string(),
  effective_risk_class: z.enum(["R0", "R1", "R2", "R3"]),
  outcome: z.enum(["ALLOW", "REQUIRE_APPROVAL", "DENY"]),
  approval_route: z.string().optional(),

  reasons: z.array(PolicyReasonSchema),

  evidence_summary: z.object({
    precedent_count: z.number().int(),
    verified_success_count: z.number().int(),
    rollback_count: z.number().int(),
    failure_count: z.number().int(),
  }),

  // Additive — LLD-v1 §2/§3, ADR-008. Set only when `outcome: DENY`
  // originates from the fixed HARD_DENY_CHECKS list, never a tenant rule.
  hard_deny_reason_code: HardDenyReasonCodeSchema.optional(),
  // Sanitized, human-readable detail alongside the code — never raw
  // exception text (LLD-v1 §3's non-blocking correction).
  hard_deny_detail: z.string().optional(),

  // Additive — LLD-v1 §2/§5, ADR-012. Computed here, consumed later by the
  // Approval Acceptance Gate — NOT enforced during policy evaluation itself.
  requires_proposer_approver_separation: z.boolean(),

  created_at: z.string().datetime(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
