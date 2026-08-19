import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaTenantActivationRepository } from "./prisma-tenant-activation-repository.js";
import { evaluateActivation } from "./tenant-activation.js";

/**
 * Real-Postgres integration coverage for the tenant activation gate
 * (story E-07). Proves the gate reads real tenant/principal rows and that
 * activation is a real technical write, not documentation. Gated behind
 * VITEST_INTEGRATION; runs against DATABASE_URL.
 */
const READY = `tenant_e07_ready_${randomUUID().slice(0, 8)}`;
const DEVROSTER = `tenant_e07_dev_${randomUUID().slice(0, 8)}`;
const NORETENTION = `tenant_e07_noret_${randomUUID().slice(0, 8)}`;
const ALL = [READY, DEVROSTER, NORETENTION];

describe("PrismaTenantActivationRepository + evaluateActivation — real gate (E-07)", () => {
  let prisma: PrismaClient;
  let repo: PrismaTenantActivationRepository;

  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new PrismaTenantActivationRepository(prisma);

    // READY: retention confirmed, only production principals.
    await prisma.tenant.create({ data: { id: READY, name: "ready", retention_policy_confirmed_at: new Date("2026-08-18T12:00:00.000Z") } });
    await prisma.identityPrincipal.create({ data: { tenant_id: READY, display_name: "oncall", roles: ["senior_oncall"], is_development_principal: false } });

    // DEVROSTER: retention confirmed, but a dev principal is present.
    await prisma.tenant.create({ data: { id: DEVROSTER, name: "dev", retention_policy_confirmed_at: new Date("2026-08-18T12:00:00.000Z") } });
    await prisma.identityPrincipal.create({ data: { tenant_id: DEVROSTER, display_name: "dev-local", roles: ["operator"], is_development_principal: true } });

    // NORETENTION: no retention decision recorded yet.
    await prisma.tenant.create({ data: { id: NORETENTION, name: "noret" } });
  });

  afterAll(async () => {
    for (const t of ALL) {
      await prisma.identityPrincipal.deleteMany({ where: { tenant_id: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
    await prisma.$disconnect();
  });

  it("CRITICAL: a READY tenant evaluates READY and markActivated() really stamps production_activated_at", async () => {
    const state = await repo.getActivationState(READY);
    expect(state.exists).toBe(true);
    expect(state.developmentPrincipalIds).toEqual([]);
    expect(evaluateActivation(state).outcome).toBe("READY");

    const at = new Date();
    const stamped = await repo.markActivated(READY, at);
    expect(stamped).toBe(at.toISOString());
    // The write is real and durable.
    const row = await prisma.tenant.findUnique({ where: { id: READY } });
    expect(row?.production_activated_at?.toISOString()).toBe(at.toISOString());
  });

  it("CRITICAL (ADR-012): a tenant with a real is_development_principal row is REJECTED", async () => {
    const state = await repo.getActivationState(DEVROSTER);
    expect(state.developmentPrincipalIds.length).toBe(1);
    const decision = evaluateActivation(state);
    expect(decision.outcome).toBe("REJECTED");
    if (decision.outcome !== "REJECTED") return;
    expect(decision.reasons.map((r) => r.code)).toContain("DEVELOPMENT_PRINCIPAL_IN_PATH");
  });

  it("CRITICAL (ADR-011): a tenant with no retention_policy_confirmed_at is REJECTED", async () => {
    const state = await repo.getActivationState(NORETENTION);
    expect(state.retentionPolicyConfirmedAt).toBeNull();
    expect(evaluateActivation(state).outcome).toBe("REJECTED");
  });

  it("reports a non-existent tenant as not existing", async () => {
    const state = await repo.getActivationState(`missing_${randomUUID().slice(0, 8)}`);
    expect(state.exists).toBe(false);
  });
});
