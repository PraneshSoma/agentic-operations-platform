import { describe, expect, it } from "vitest";
import type { ActionDefinition } from "@aop/contracts";
import { InMemoryActionRegistry } from "./action-registry.js";

function operationalAction(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    action_id: "restart_service",
    version: "1.0.0",
    tenant_id: "tenant_1",
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
    ...overrides,
  };
}

/** An engineering-change action — its executor_connector_ref points at the Build-loop executor (CONTEXT.md), not an ops connector. */
function engineeringChangeAction(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return operationalAction({
    action_id: "fix_config_drift",
    executor_connector_ref: "engineering-change-executor",
    operation: "run_scoped_story",
    compensation_class: "COMPENSATABLE",
    reversible: false,
    ...overrides,
  });
}

describe("InMemoryActionRegistry", () => {
  it("registers and looks up an action by the full (tenant_id, action_ref, version) key (F-07)", () => {
    const registry = new InMemoryActionRegistry();
    const action = operationalAction();
    registry.register(action);
    expect(registry.lookup("tenant_1", "restart_service", "1.0.0")).toEqual(action);
  });

  it("returns undefined when action_ref matches but version doesn't — lookup is never by action_ref alone", () => {
    const registry = new InMemoryActionRegistry();
    registry.register(operationalAction({ version: "1.0.0" }));
    expect(registry.lookup("tenant_1", "restart_service", "2.0.0")).toBeUndefined();
  });

  it("returns undefined for a wrong tenant_id — no cross-tenant lookup (RULE 4)", () => {
    const registry = new InMemoryActionRegistry();
    registry.register(operationalAction());
    expect(registry.lookup("tenant_2", "restart_service", "1.0.0")).toBeUndefined();
  });

  it("two versions of the same action_ref coexist independently", () => {
    const registry = new InMemoryActionRegistry();
    registry.register(operationalAction({ version: "1.0.0", description: "v1" }));
    registry.register(operationalAction({ version: "2.0.0", description: "v2" }));
    expect(registry.lookup("tenant_1", "restart_service", "1.0.0")?.description).toBe("v1");
    expect(registry.lookup("tenant_1", "restart_service", "2.0.0")?.description).toBe("v2");
  });

  it("lookupActive returns the action when status is active", () => {
    const registry = new InMemoryActionRegistry();
    registry.register(operationalAction({ status: "active" }));
    expect(registry.lookupActive("tenant_1", "restart_service", "1.0.0")).toBeDefined();
  });

  it("lookupActive returns undefined when status is disabled", () => {
    const registry = new InMemoryActionRegistry();
    registry.register(operationalAction({ status: "disabled" }));
    expect(registry.lookupActive("tenant_1", "restart_service", "1.0.0")).toBeUndefined();
  });

  it("lookupActive returns undefined when the action was never registered at all", () => {
    const registry = new InMemoryActionRegistry();
    expect(registry.lookupActive("tenant_1", "never_registered", "1.0.0")).toBeUndefined();
  });

  it("CRITICAL (RULE 8): an operational action and an engineering-change action register and resolve through the identical code path — no branch on kind", () => {
    const registry = new InMemoryActionRegistry();
    const ops = operationalAction();
    const engChange = engineeringChangeAction();

    // Same register() call, same lookup() call, for both — nothing about
    // this test (or the registry's own source) treats them differently.
    registry.register(ops);
    registry.register(engChange);

    const resolvedOps = registry.lookup("tenant_1", ops.action_id, ops.version);
    const resolvedEngChange = registry.lookup("tenant_1", engChange.action_id, engChange.version);

    expect(resolvedOps).toEqual(ops);
    expect(resolvedEngChange).toEqual(engChange);
    // Both are equally "just an ActionDefinition" to the registry — the
    // only thing distinguishing them is data (executor_connector_ref),
    // never a code branch.
    expect(resolvedOps?.executor_connector_ref).toBe("k8s-connector");
    expect(resolvedEngChange?.executor_connector_ref).toBe("engineering-change-executor");
  });

  it("CRITICAL (D-04, ADR-001): register() rejects an inconsistent reversible/compensation_class pair — the invariant is enforced at registration, not merely expressible in the type", () => {
    const registry = new InMemoryActionRegistry();
    // Structurally satisfies the ActionDefinition TS type (the cross-field
    // refinement isn't checkable at compile time) but violates ADR-001:
    // reversible: true requires compensation_class: REVERSIBLE.
    const inconsistent = operationalAction({ reversible: true, compensation_class: "IRREVERSIBLE" });
    expect(() => registry.register(inconsistent)).toThrow();
    expect(registry.lookup("tenant_1", inconsistent.action_id, inconsistent.version)).toBeUndefined();
  });

  it("re-registering the same (tenant_id, action_ref, version) overwrites — the registry is not append-only", () => {
    const registry = new InMemoryActionRegistry();
    registry.register(operationalAction({ status: "active" }));
    registry.register(operationalAction({ status: "disabled" }));
    expect(registry.lookup("tenant_1", "restart_service", "1.0.0")?.status).toBe("disabled");
  });
});
