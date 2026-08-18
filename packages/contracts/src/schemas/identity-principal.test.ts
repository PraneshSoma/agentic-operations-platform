import { describe, expect, it } from "vitest";
import { IdentityPrincipalSchema } from "./identity-principal.js";

const validPayload = {
  id: "principal_1",
  tenant_id: "tenant_1",
  display_name: "Dev Operator",
  roles: ["operator"],
  is_development_principal: true,
  created_at: "2026-08-18T00:00:00.000Z",
};

describe("IdentityPrincipalSchema", () => {
  it("accepts a valid payload matching LLD-v1 §2's identity_principal shape", () => {
    expect(IdentityPrincipalSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts is_development_principal: false for a (future) production principal", () => {
    expect(IdentityPrincipalSchema.safeParse({ ...validPayload, is_development_principal: false }).success).toBe(true);
  });

  it("accepts an empty roles array", () => {
    expect(IdentityPrincipalSchema.safeParse({ ...validPayload, roles: [] }).success).toBe(true);
  });

  it("rejects a non-boolean is_development_principal — must be an explicit flag, never inferred", () => {
    expect(IdentityPrincipalSchema.safeParse({ ...validPayload, is_development_principal: "true" }).success).toBe(false);
  });

  it.each(["id", "tenant_id", "display_name", "roles", "is_development_principal", "created_at"])(
    "rejects when required field %s is missing",
    (field) => {
      const broken = structuredClone(validPayload) as Record<string, unknown>;
      delete broken[field];
      expect(IdentityPrincipalSchema.safeParse(broken).success).toBe(false);
    },
  );
});
