import { describe, expect, it } from "vitest";
import { ActionDefinitionSchema } from "./action-definition.js";

const reversibleAction = {
  action_id: "restart_service",
  version: "1.0.0",
  tenant_id: "tenant_abc",
  name: "Restart Service",
  description: "Restarts a service instance",
  executor_connector_ref: "k8s-connector",
  operation: "restart",
  input_schema: {},
  default_risk_class: "R1",
  blast_radius: { scope: "service" },
  reversible: true,
  environment_constraints: { allowed: ["prod"] },
  policy_tags: [],
  status: "active",
  compensation_class: "REVERSIBLE",
};

describe("ActionDefinitionSchema", () => {
  it("accepts a valid REVERSIBLE action matching spec §13's shape", () => {
    expect(ActionDefinitionSchema.safeParse(reversibleAction).success).toBe(true);
  });

  it("accepts a valid COMPENSATABLE action (reversible: false)", () => {
    const compensatable = { ...reversibleAction, reversible: false, compensation_class: "COMPENSATABLE" };
    expect(ActionDefinitionSchema.safeParse(compensatable).success).toBe(true);
  });

  it("accepts a valid IRREVERSIBLE action (reversible: false)", () => {
    const irreversible = { ...reversibleAction, reversible: false, compensation_class: "IRREVERSIBLE" };
    expect(ActionDefinitionSchema.safeParse(irreversible).success).toBe(true);
  });

  it("CRITICAL: rejects reversible: true paired with compensation_class: COMPENSATABLE — ADR-001's consistency rule enforced at the schema level, not just documented", () => {
    const inconsistent = { ...reversibleAction, reversible: true, compensation_class: "COMPENSATABLE" };
    expect(ActionDefinitionSchema.safeParse(inconsistent).success).toBe(false);
  });

  it("CRITICAL: rejects reversible: false paired with compensation_class: REVERSIBLE", () => {
    const inconsistent = { ...reversibleAction, reversible: false, compensation_class: "REVERSIBLE" };
    expect(ActionDefinitionSchema.safeParse(inconsistent).success).toBe(false);
  });

  it("rejects an out-of-enum blast_radius.scope value", () => {
    const broken = { ...reversibleAction, blast_radius: { scope: "the_whole_internet" } };
    expect(ActionDefinitionSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum environment_constraints.allowed value", () => {
    const broken = { ...reversibleAction, environment_constraints: { allowed: ["moon"] } };
    expect(ActionDefinitionSchema.safeParse(broken).success).toBe(false);
  });
});
