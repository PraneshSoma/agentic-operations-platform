import type { PrismaClient } from "@prisma/client";

/**
 * The tenant-activation read/write boundary (story E-07). Pluggable so the
 * onboarding route can be exercised with an in-memory fake while the real
 * Prisma implementation is integration-tested.
 */
export interface TenantActivationState {
  exists: boolean;
  retentionPolicyConfirmedAt: string | null;
  productionActivatedAt: string | null;
  developmentPrincipalIds: string[];
}

export interface TenantActivationRepository {
  getActivationState(tenantId: string): Promise<TenantActivationState>;
  /** The activation write itself — stamps production_activated_at. Returns the stamped time. */
  markActivated(tenantId: string, at: Date): Promise<string>;
}

/**
 * Prisma-backed TenantActivationRepository. Reads the tenant row's
 * retention/activation timestamps and the tenant's is_development_principal
 * roster; the only write is the activation stamp itself (the gate's
 * sanctioned side effect). Integration-tested against a real Postgres,
 * excluded from the default unit-coverage gate.
 */
export class PrismaTenantActivationRepository implements TenantActivationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getActivationState(tenantId: string): Promise<TenantActivationState> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return { exists: false, retentionPolicyConfirmedAt: null, productionActivatedAt: null, developmentPrincipalIds: [] };
    }
    const devPrincipals = await this.prisma.identityPrincipal.findMany({
      where: { tenant_id: tenantId, is_development_principal: true },
      select: { id: true },
    });
    return {
      exists: true,
      retentionPolicyConfirmedAt: tenant.retention_policy_confirmed_at?.toISOString() ?? null,
      productionActivatedAt: tenant.production_activated_at?.toISOString() ?? null,
      developmentPrincipalIds: devPrincipals.map((p) => p.id),
    };
  }

  async markActivated(tenantId: string, at: Date): Promise<string> {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { production_activated_at: at } });
    return at.toISOString();
  }
}
