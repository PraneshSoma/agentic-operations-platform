import { IdentityPrincipalSchema, type IdentityPrincipal } from "@aop/contracts";
import type { IdentityResolver, RiskClass } from "./identity-resolver.js";

/**
 * A dev principal's raw config shape (ADR-012: "a small YAML/JSON list of
 * {id, tenant_id, roles} entries"). is_development_principal is NOT a
 * field here — LocalDevIdentityResolver sets it to `true` on every
 * principal it constructs, unconditionally. This isn't optional
 * configuration a caller could get wrong; it's what makes this
 * implementation what it is.
 */
export interface DevPrincipalConfig {
  id: string;
  tenant_id: string;
  display_name: string;
  roles: readonly string[];
  created_at?: Date;
}

/**
 * Default role -> approvable-risk-classes mapping (ADR-012's "whether the
 * approver's roles satisfy the risk class being approved"). A dev-only
 * default, tenant-configurable in a later story once real tenant policy
 * (C-03) exists — overridable via the constructor for tests and local
 * dev tuning in the meantime.
 */
export const DEFAULT_ROLE_RISK_CLASS_PERMISSIONS: Readonly<Record<string, readonly RiskClass[]>> = {
  operator: ["R0", "R1"],
  approver: ["R0", "R1", "R2"],
  senior_oncall: ["R0", "R1", "R2", "R3"],
  platform_owner: ["R0", "R1", "R2", "R3"],
};

function key(tenantId: string, actorId: string): string {
  return `${tenantId}::${actorId}`;
}

/**
 * LocalDevIdentityResolver — ADR-012's "local development implementation":
 * a fixed, config-defined set of development principals, no external
 * call, no real SSO. Every principal it knows about is flagged
 * is_development_principal: true (story C-01's acceptance criterion).
 */
export class LocalDevIdentityResolver implements IdentityResolver {
  private readonly principals: Map<string, IdentityPrincipal>;

  constructor(
    devPrincipals: readonly DevPrincipalConfig[],
    private readonly roleRiskClassPermissions: Readonly<Record<string, readonly RiskClass[]>> = DEFAULT_ROLE_RISK_CLASS_PERMISSIONS,
  ) {
    this.principals = new Map(
      devPrincipals.map((p) => [
        key(p.tenant_id, p.id),
        IdentityPrincipalSchema.parse({
          id: p.id,
          tenant_id: p.tenant_id,
          display_name: p.display_name,
          roles: p.roles,
          is_development_principal: true,
          created_at: (p.created_at ?? new Date()).toISOString(),
        }),
      ]),
    );
  }

  async resolve(tenantId: string, actorId: string): Promise<IdentityPrincipal | undefined> {
    return this.principals.get(key(tenantId, actorId));
  }

  hasRiskClassApprovalPermission(principal: IdentityPrincipal, riskClass: RiskClass): boolean {
    return principal.roles.some((role) => (this.roleRiskClassPermissions[role] ?? []).includes(riskClass));
  }
}
