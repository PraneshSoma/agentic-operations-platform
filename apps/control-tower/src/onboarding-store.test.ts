import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OnboardingStore, validateOnboarding, type OnboardedAppInput } from "./onboarding-store.js";

const valid = (): OnboardedAppInput => ({
  name: "Orders", owner: "Commerce", environment: "STAGING", description: "Order APIs", status: "ACTIVE",
  services: [{ id: "orders", name: "Orders API", baseUrl: "https://orders.internal", healthPath: "/healthz", access: { mode: "CONTROLLED_WRITE", allowedActions: ["restart"], credentialRef: "vault:commerce/orders", approvalRequired: true } }],
  triggers: [{ id: "latency", type: "METRIC", event: "orders.p95", condition: "> 1s", severity: "P1", enabled: true }],
  sops: [{ id: "slow-orders", name: "Slow orders", version: "1.0.0", matchTerms: ["latency"], serviceIds: ["orders"], steps: ["inspect", "restart", "verify"], riskClass: "R2", approvalRole: "senior_oncall", enabled: true }],
});

describe("onboarding registry", () => {
  it("accepts a complete app and rejects raw credentials or unsafe SOP references", () => {
    expect(validateOnboarding(valid()).ok).toBe(true);
    const bad = valid();
    bad.services[0]!.access.credentialRef = "secret-password";
    bad.sops[0]!.serviceIds = ["missing"];
    expect(validateOnboarding(bad).issues).toEqual(expect.arrayContaining([expect.stringContaining("credential must be a reference"), expect.stringContaining("unknown service")]));
  });

  it("seeds the customer domain and persists new applications", () => {
    const path = join(tmpdir(), `aop-onboarding-${Date.now()}-${Math.random()}.json`);
    const now = () => new Date("2026-08-21T12:00:00.000Z");
    const store = new OnboardingStore(path, now);
    expect(store.get("app_customer_wallet")?.services).toHaveLength(2);
    const created = store.upsert(valid());
    expect(created.id).toMatch(/^app_/);
    expect(new OnboardingStore(path, now).get(created.id)?.name).toBe("Orders");
  });
});
