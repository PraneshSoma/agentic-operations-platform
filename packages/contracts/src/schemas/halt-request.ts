import { z } from "zod";

/**
 * HaltRequest (spec §7A) — the payload behind `POST /executions/{id}/halt`
 * and `POST /tenants/{tenantId}/halt-all`. `actor.role` is carried through
 * as audit context (who claimed what role when triggering the halt) —
 * it is never the authorization check itself; the actual authorization
 * decision resolves `actor.id`'s real roles via IdentityResolver and
 * checks those against the tenant's `required_halt_roles` (story D-05),
 * the same "never trust a caller-asserted role" discipline the Approval
 * Acceptance Gate already applies (C-04).
 */
export const HaltRequestSchema = z.object({
  actor: z.object({
    id: z.string(),
    role: z.string(),
  }),
  scope: z.enum(["single_execution", "all_tenant_executions"]),
  reason: z.string(),
  created_at: z.string().datetime(),
});

export type HaltRequest = z.infer<typeof HaltRequestSchema>;
