import { describe, expect, it } from "vitest";
import type { TenantActivationRepository, TenantActivationState } from "@aop/evidence-ledger";
import { buildApp } from "../app.js";

/** In-memory fake — proves the route's gate logic + the activation write (the Prisma impl is integration-tested). */
class FakeTenantActivationRepository implements TenantActivationRepository {
  activatedAt: string | undefined;
  constructor(private readonly state: TenantActivationState) {
    this.activatedAt = state.productionActivatedAt ?? undefined;
  }
  async getActivationState(): Promise<TenantActivationState> {
    return { ...this.state, productionActivatedAt: this.activatedAt ?? null };
  }
  async markActivated(_tenantId: string, at: Date): Promise<string> {
    this.activatedAt = at.toISOString();
    return this.activatedAt;
  }
}

function appWith(state: Partial<TenantActivationState>) {
  const repo = new FakeTenantActivationRepository({
    exists: true,
    retentionPolicyConfirmedAt: null,
    productionActivatedAt: null,
    developmentPrincipalIds: [],
    ...state,
  });
  return { app: buildApp({ tenantActivationRepository: repo }), repo };
}

describe("POST /tenants/:tenantId/onboarding/activate (E-07, ADR-011 + ADR-012)", () => {
  it("CRITICAL: activates (200) and stamps production_activated_at when retention is confirmed and no dev principals exist", async () => {
    const { app, repo } = appWith({ retentionPolicyConfirmedAt: "2026-08-18T12:00:00.000Z", developmentPrincipalIds: [] });
    const response = await app.inject({ method: "POST", url: "/tenants/tenant_1/onboarding/activate" });
    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe("ACTIVATED");
    expect(typeof response.json().production_activated_at).toBe("string");
    expect(repo.activatedAt).toBeDefined(); // the write really happened
  });

  it("CRITICAL: rejects (409) and stamps NOTHING when retention is not confirmed", async () => {
    const { app, repo } = appWith({ retentionPolicyConfirmedAt: null, developmentPrincipalIds: [] });
    const response = await app.inject({ method: "POST", url: "/tenants/tenant_1/onboarding/activate" });
    expect(response.statusCode).toBe(409);
    expect(response.json().outcome).toBe("REJECTED");
    expect(response.json().reasons).toContainEqual({ code: "RETENTION_POLICY_NOT_CONFIRMED" });
    expect(repo.activatedAt).toBeUndefined(); // no activation write on rejection
  });

  it("CRITICAL: rejects (409) when a development principal is in the tenant's roster", async () => {
    const { app } = appWith({ retentionPolicyConfirmedAt: "2026-08-18T12:00:00.000Z", developmentPrincipalIds: ["dev_1"] });
    const response = await app.inject({ method: "POST", url: "/tenants/tenant_1/onboarding/activate" });
    expect(response.statusCode).toBe(409);
    expect(response.json().reasons).toContainEqual({ code: "DEVELOPMENT_PRINCIPAL_IN_PATH", development_principal_ids: ["dev_1"] });
  });

  it("is idempotent — an already-activated tenant returns 200 ALREADY_ACTIVATED with its existing stamp", async () => {
    const { app } = appWith({ productionActivatedAt: "2026-08-01T00:00:00.000Z" });
    const response = await app.inject({ method: "POST", url: "/tenants/tenant_1/onboarding/activate" });
    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe("ALREADY_ACTIVATED");
    expect(response.json().production_activated_at).toBe("2026-08-01T00:00:00.000Z");
  });

  it("returns 404 for an unknown tenant", async () => {
    const { app } = appWith({ exists: false });
    const response = await app.inject({ method: "POST", url: "/tenants/never/onboarding/activate" });
    expect(response.statusCode).toBe(404);
  });

  it("the onboarding route is not registered when no repository is provided", async () => {
    const response = await buildApp().inject({ method: "POST", url: "/tenants/tenant_1/onboarding/activate" });
    expect(response.statusCode).toBe(404);
  });
});
