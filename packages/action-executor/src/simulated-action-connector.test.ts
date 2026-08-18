import { describe, expect, it } from "vitest";
import type { ActionDefinition, ConnectorDescriptor, ExecutionAuthorization } from "@aop/contracts";
import { EnvVarSecretResolver } from "@aop/secrets";
import { ExpiredAuthorizationError, MissingAuthorizationError } from "./action-connector.js";
import { SimulatedActionConnector } from "./simulated-action-connector.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const secretResolver = new EnvVarSecretResolver({ SIM_ACTION_KEY: "sk-fixture-secret" });

const descriptor: ConnectorDescriptor = {
  connector_id: "sim-action-connector",
  tenant_id: "tenant_1",
  type: "api",
  operations: [{ name: "restart", input_schema: {}, output_schema: {} }],
  authorization: { mode: "api_key", secret_ref: "secret://SIM_ACTION_KEY" },
  scopes: { environments: ["prod"], applications: ["checkout-service"] },
  staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" },
  definition_version: "1.0.0",
  supports_correlation: false,
  is_idempotent: false,
  reliability_level: "MEDIUM",
};

function actionDefinition(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    action_id: "restart_service",
    version: "1.0.0",
    tenant_id: "tenant_1",
    name: "Restart Service",
    description: "Restarts a service instance",
    executor_connector_ref: "sim-action-connector",
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

function authorization(overrides: Partial<ExecutionAuthorization> = {}): ExecutionAuthorization {
  return {
    authorization_id: "auth_1",
    proposal_id: "prop_1",
    policy_decision_id: "dec_1",
    identity: { mode: "ON_BEHALF_OF", acting_as: { id: "user_approver", type: "human" }, approver_ref: "user_approver", requester_ref: "user_proposer" },
    delegation: { token_type: "none", scopes: [], issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 15 * 60 * 1000).toISOString() },
    signed_plan_hash: "sha256:x",
    issued_by: "approval-acceptance-gate",
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

describe("SimulatedActionConnector — implements the full ActionConnector interface against a fake target (F-18 MVP)", () => {
  it("validateAction() accepts an active action whose executor_connector_ref matches this connector", () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map(), () => NOW);
    expect(connector.validateAction(actionDefinition(), {})).toEqual({ valid: true, errors: [] });
  });

  it("validateAction() rejects a disabled action", () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map(), () => NOW);
    const result = connector.validateAction(actionDefinition({ status: "disabled" }), {});
    expect(result.valid).toBe(false);
  });

  it("validateAction() rejects when executor_connector_ref doesn't match this connector", () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map(), () => NOW);
    const result = connector.validateAction(actionDefinition({ executor_connector_ref: "some-other-connector" }), {});
    expect(result.valid).toBe(false);
  });

  it("preflight() returns MATCH when the target state matches expected preconditions exactly", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const result = await connector.preflight(actionDefinition(), {}, {
      checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }],
    });
    expect(result.status).toBe("MATCH");
  });

  it("CRITICAL: preflight() returns DRIFTED when a staged drift in target state doesn't match the expected precondition", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["version", "1.2.4"]]), () => NOW); // drifted
    const result = await connector.preflight(actionDefinition(), {}, {
      checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }],
    });
    expect(result.status).toBe("DRIFTED");
    expect(result.drifted_fields).toEqual([{ field_ref: "version", expected: "1.2.3", observed: "1.2.4" }]);
  });

  it("preflight() returns UNKNOWN (never an implicit pass) when the field can't be observed at all", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map(), () => NOW); // no "version" key at all
    const result = await connector.preflight(actionDefinition(), {}, {
      checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }],
    });
    expect(result.status).toBe("UNKNOWN");
  });

  it("preflight() supports within_range tolerance", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["cpu_percent", 42]]), () => NOW);
    const inRange = await connector.preflight(actionDefinition(), {}, {
      checks: [{ field_ref: "cpu_percent", expected_value: { min: 0, max: 80 }, tolerance: "within_range" }],
    });
    expect(inRange.status).toBe("MATCH");

    const outOfRange = await connector.preflight(actionDefinition(), {}, {
      checks: [{ field_ref: "cpu_percent", expected_value: { min: 90, max: 100 }, tolerance: "within_range" }],
    });
    expect(outOfRange.status).toBe("DRIFTED");
  });

  it("preflight() supports unchanged_since tolerance", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["owner", "team-checkout"]]), () => NOW);
    const unchanged = await connector.preflight(actionDefinition(), {}, {
      checks: [{ field_ref: "owner", expected_value: "team-checkout", tolerance: "unchanged_since" }],
    });
    expect(unchanged.status).toBe("MATCH");

    const changed = await connector.preflight(actionDefinition(), {}, {
      checks: [{ field_ref: "owner", expected_value: "team-billing", tolerance: "unchanged_since" }],
    });
    expect(changed.status).toBe("DRIFTED");
  });

  it("CRITICAL: execute() rejects when called without a resolved ExecutionAuthorization", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map(), () => NOW);
    await expect(connector.execute(actionDefinition(), { version: "2.0.0" }, undefined)).rejects.toThrow(MissingAuthorizationError);
  });

  it("execute() rejects an expired ExecutionAuthorization", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map(), () => NOW);
    const expired = authorization({ delegation: { token_type: "none", scopes: [], issued_at: "2026-08-18T00:00:00.000Z", expires_at: "2026-08-18T00:10:00.000Z" } });
    await expect(connector.execute(actionDefinition(), { version: "2.0.0" }, expired)).rejects.toThrow(ExpiredAuthorizationError);
  });

  it("execute() genuinely mutates the simulated target and returns a schema-valid ExecutionResult", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const result = await connector.execute(actionDefinition(), { version: "1.3.0" }, authorization());
    expect(result.status).toBe("SUCCESS");
    expect(result.proposal_id).toBe("prop_1");
    expect(connector.getTargetState("version")).toBe("1.3.0");
  });

  it("rollback() rejects when called without a resolved ExecutionAuthorization", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const executed = await connector.execute(actionDefinition(), { version: "1.3.0" }, authorization());
    await expect(connector.rollback!(executed, undefined)).rejects.toThrow(MissingAuthorizationError);
  });

  it("rollback() genuinely reverts the simulated target to its pre-execute state", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const executed = await connector.execute(actionDefinition(), { version: "1.3.0" }, authorization());
    expect(connector.getTargetState("version")).toBe("1.3.0");

    const rolledBack = await connector.rollback!(executed, authorization());
    expect(rolledBack.status).toBe("SUCCESS");
    expect(connector.getTargetState("version")).toBe("1.2.3");
  });

  it("rollback() throws when no execute() snapshot exists for the given execution result", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map(), () => NOW);
    const fakeResult = { ...(await connector.execute(actionDefinition(), { x: 1 }, authorization())), execution_result_id: "never_executed" };
    await expect(connector.rollback!(fakeResult, authorization())).rejects.toThrow(/No rollback snapshot/);
  });

  it("descriptor() returns exactly the ConnectorDescriptor passed at construction", () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map(), () => NOW);
    expect(connector.descriptor()).toBe(descriptor);
  });

  it("defaults `now` to the real wall clock when not injected", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver);
    const before = Date.now();
    const result = await connector.execute(actionDefinition(), { x: 1 }, authorization({ delegation: { token_type: "none", scopes: [], issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() } }));
    const after = Date.now();
    const startedAtMs = new Date(result.started_at).getTime();
    expect(startedAtMs).toBeGreaterThanOrEqual(before);
    expect(startedAtMs).toBeLessThanOrEqual(after);
  });
});
