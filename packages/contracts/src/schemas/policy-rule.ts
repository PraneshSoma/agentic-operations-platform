import { z } from "zod";

/**
 * PolicyRule (spec §16) — one tenant-authored rule the Policy Engine's
 * Phase 2 evaluates (packages/policy-engine, story C-03). Deterministic:
 * `when` matches structurally against the proposed action's environment
 * and effective risk class, `decision` is the outcome if matched.
 */
export const PolicyRuleSchema = z.object({
  rule_id: z.string(),
  when: z.object({
    environment: z.string().optional(),
    risk_class_in: z.array(z.enum(["R0", "R1", "R2", "R3"])).optional(),
  }),
  decision: z.enum(["ALLOW", "REQUIRE_APPROVAL", "DENY"]),
  approval_route: z.string().optional(),

  // Additive — LLD-v1 §2, ADR-012 (Revision 2, Finding 2). Computed here
  // at Phase 2, consumed later by the Approval Acceptance Gate (LLD-v1
  // §5) — NOT enforced during policy evaluation itself.
  requires_proposer_approver_separation: z.boolean().optional(),

  // Additive. ADR-008's hard-deny category names "immutable policy
  // constraint violation (a rule the tenant has marked non-overridable
  // in policy config)" as one of the 7 non-overridable DENY conditions,
  // but doesn't give the concept a field name — this operationalizes it:
  // an `immutable: true` rule whose `when` matches and whose `decision`
  // is DENY is enforced in Phase 1 (packages/policy-engine/src/hard-deny.ts),
  // before ordinary Phase 2 rules run, and cannot be relaxed by any other
  // rule. Defaults to false — a rule is ordinary/overridable unless
  // explicitly marked otherwise.
  immutable: z.boolean().default(false),
});

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
