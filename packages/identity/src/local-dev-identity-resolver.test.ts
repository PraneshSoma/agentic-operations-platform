import { describe, expect, it } from "vitest";
import { IdentityPrincipalSchema } from "@aop/contracts";
import { DEFAULT_ROLE_RISK_CLASS_PERMISSIONS, LocalDevIdentityResolver } from "./local-dev-identity-resolver.js";

const devPrincipals = [
  { id: "user_operator", tenant_id: "tenant_1", display_name: "Dev Operator", roles: ["operator"] },
  { id: "user_senior_oncall", tenant_id: "tenant_1", display_name: "Dev Senior On-Call", roles: ["senior_oncall"] },
  { id: "user_multi_role", tenant_id: "tenant_1", display_name: "Dev Multi-Role", roles: ["operator", "approver"] },
];

describe("LocalDevIdentityResolver", () => {
  it("resolves an actor reference to identity, tenant_id, and roles (ADR-012, LLD §5)", async () => {
    const resolver = new LocalDevIdentityResolver(devPrincipals);
    const principal = await resolver.resolve("tenant_1", "user_operator");
    expect(principal).toBeDefined();
    expect(IdentityPrincipalSchema.safeParse(principal).success).toBe(true);
    expect(principal?.tenant_id).toBe("tenant_1");
    expect(principal?.roles).toEqual(["operator"]);
  });

  it("returns undefined for an unknown actor_id", async () => {
    const resolver = new LocalDevIdentityResolver(devPrincipals);
    expect(await resolver.resolve("tenant_1", "user_never_configured")).toBeUndefined();
  });

  it("returns undefined for a known actor_id under the wrong tenant_id — no cross-tenant resolution (RULE 4)", async () => {
    const resolver = new LocalDevIdentityResolver(devPrincipals);
    expect(await resolver.resolve("tenant_2", "user_operator")).toBeUndefined();
  });

  it("CRITICAL: every principal is flagged is_development_principal: true, unconditionally", async () => {
    const resolver = new LocalDevIdentityResolver(devPrincipals);
    const principal = await resolver.resolve("tenant_1", "user_operator");
    expect(principal?.is_development_principal).toBe(true);
  });

  it("CRITICAL: resolves both an IncomingRequest.requester-style lookup and an ApprovalDecision.actor-style lookup through the identical table", async () => {
    const resolver = new LocalDevIdentityResolver(devPrincipals);
    // Same actor, two different semantic call sites (trigger requester vs.
    // approval actor) — both go through resolve() against the same
    // backing principal map, so they must return identical results.
    const asRequester = await resolver.resolve("tenant_1", "user_operator"); // e.g. IncomingRequest.requester.id
    const asApprover = await resolver.resolve("tenant_1", "user_operator"); // e.g. ApprovalDecision.actor
    expect(asRequester).toEqual(asApprover);
  });

  it("hasRiskClassApprovalPermission: an operator may approve R0/R1 but not R2/R3 (default dev mapping)", async () => {
    const resolver = new LocalDevIdentityResolver(devPrincipals);
    const principal = (await resolver.resolve("tenant_1", "user_operator"))!;
    expect(resolver.hasRiskClassApprovalPermission(principal, "R1")).toBe(true);
    expect(resolver.hasRiskClassApprovalPermission(principal, "R2")).toBe(false);
  });

  it("hasRiskClassApprovalPermission: senior_oncall may approve up through R3 (default dev mapping)", async () => {
    const resolver = new LocalDevIdentityResolver(devPrincipals);
    const principal = (await resolver.resolve("tenant_1", "user_senior_oncall"))!;
    expect(resolver.hasRiskClassApprovalPermission(principal, "R3")).toBe(true);
  });

  it("hasRiskClassApprovalPermission: a principal with multiple roles gets the union of permissions", async () => {
    const resolver = new LocalDevIdentityResolver(devPrincipals);
    const principal = (await resolver.resolve("tenant_1", "user_multi_role"))!;
    expect(resolver.hasRiskClassApprovalPermission(principal, "R2")).toBe(true); // via "approver"
  });

  it("hasRiskClassApprovalPermission returns false for a role with no configured permissions at all", async () => {
    const resolverWithUnknownRole = new LocalDevIdentityResolver([
      { id: "user_x", tenant_id: "tenant_1", display_name: "X", roles: ["unconfigured_role"] },
    ]);
    const principal = (await resolverWithUnknownRole.resolve("tenant_1", "user_x"))!;
    expect(resolverWithUnknownRole.hasRiskClassApprovalPermission(principal, "R0")).toBe(false);
  });

  it("accepts an injected custom role/risk-class permission map, overriding the default", async () => {
    const resolver = new LocalDevIdentityResolver(devPrincipals, { operator: ["R0", "R1", "R2", "R3"] });
    const principal = (await resolver.resolve("tenant_1", "user_operator"))!;
    expect(resolver.hasRiskClassApprovalPermission(principal, "R3")).toBe(true);
  });

  it("DEFAULT_ROLE_RISK_CLASS_PERMISSIONS is exported and usable directly", () => {
    expect(DEFAULT_ROLE_RISK_CLASS_PERMISSIONS.operator).toEqual(["R0", "R1"]);
  });

  it("supports an explicit created_at override", async () => {
    const explicitDate = new Date("2020-01-01T00:00:00.000Z");
    const resolver = new LocalDevIdentityResolver([
      { id: "user_x", tenant_id: "tenant_1", display_name: "X", roles: [], created_at: explicitDate },
    ]);
    const principal = await resolver.resolve("tenant_1", "user_x");
    expect(principal?.created_at).toBe(explicitDate.toISOString());
  });
});
