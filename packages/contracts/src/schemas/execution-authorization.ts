import { z } from "zod";

/**
 * ExecutionAuthorization — a signed authorization to run one action, issued
 * only by the Approval Acceptance Gate after every check passes (spec
 * §14A, LLD-v1 §5). ON_BEHALF_OF is required by default for R2/R3 unless a
 * tenant explicitly opts out (spec §14A rule) — enforced by the issuing
 * gate, not this schema.
 */
export const ExecutionAuthorizationSchema = z.object({
  authorization_id: z.string(),
  proposal_id: z.string(),
  policy_decision_id: z.string(),

  identity: z.object({
    mode: z.enum(["SERVICE_ACCOUNT", "ON_BEHALF_OF"]),
    acting_as: z.object({
      id: z.string(),
      type: z.enum(["platform_service_account", "human"]),
    }),
    approver_ref: z.string().optional(),
    requester_ref: z.string().optional(),
  }),

  delegation: z.object({
    token_type: z.enum(["obo", "scoped_short_lived", "none"]),
    token_ref: z.string().optional(),
    scopes: z.array(z.string()),
    issued_at: z.string().datetime(),
    expires_at: z.string().datetime(),
  }),

  signed_plan_hash: z.string(),
  issued_by: z.string(),
  created_at: z.string().datetime(),
});

export type ExecutionAuthorization = z.infer<typeof ExecutionAuthorizationSchema>;
