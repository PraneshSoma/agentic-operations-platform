import { z } from "zod";

/**
 * IdentityPrincipal — the domain-level shape resolved by IdentityResolver
 * (ADR-012, LLD-v1 §2/§5, story C-01). Mirrors the `identity_principal`
 * table's field list exactly (LLD-v1 §2), but is a separate, independently
 * validated wire/domain contract — the same pattern every other table in
 * this repo follows (e.g. Evidence vs. the `evidence` table).
 *
 * is_development_principal must be clearly flagged, never inferred: ADR-012
 * requires dev principals be unmistakably labeled non-production, same
 * discipline as ADR-011's dev-only retention default — a real pilot must
 * never accidentally run on placeholder identities.
 */
export const IdentityPrincipalSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  display_name: z.string(),
  roles: z.array(z.string()),
  is_development_principal: z.boolean(),
  created_at: z.string().datetime(),
});

export type IdentityPrincipal = z.infer<typeof IdentityPrincipalSchema>;
