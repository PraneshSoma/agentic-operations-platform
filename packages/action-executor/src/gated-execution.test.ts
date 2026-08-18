import { describe, expect, it } from "vitest";
import type { ActionDefinition, ConnectorDescriptor, ExecutionAuthorization, ExecutionResult, PreconditionSet, PreflightResult } from "@aop/contracts";
import { EnvVarSecretResolver } from "@aop/secrets";
import type { ActionConnector, ValidationResult } from "./action-connector.js";
import { runGatedExecution } from "./gated-execution.js";
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

/** A connector whose execute() throws if ever reached — used to prove runGatedExecution() never calls it when preflight blocks. */
class ExecuteMustNotBeCalledConnector implements ActionConnector {
  constructor(private readonly preflightResult: PreflightResult) {}
  descriptor(): ConnectorDescriptor {
    return descriptor;
  }
  validateAction(): ValidationResult {
    return { valid: true, errors: [] };
  }
  async preflight(): Promise<PreflightResult> {
    return this.preflightResult;
  }
  async execute(): Promise<ExecutionResult> {
    throw new Error("execute() must never be called when preflight blocks — this is the bug D-02 exists to prevent");
  }
}

const preconditions: PreconditionSet = {
  checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }],
};

describe("runGatedExecution() — structural preflight-then-execute gate (D-02, F-10)", () => {
  it("MATCH: runs preflight, then executes, and returns the EXECUTED outcome with both results", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const result = await runGatedExecution(connector, actionDefinition(), { version: "1.3.0" }, preconditions, authorization());

    expect(result.outcome).toBe("EXECUTED");
    if (result.outcome !== "EXECUTED") return;
    expect(result.preflightResult.status).toBe("MATCH");
    expect(result.executionResult.status).toBe("SUCCESS");
    expect(connector.getTargetState("version")).toBe("1.3.0");
  });

  it("CRITICAL: DRIFTED blocks execution unconditionally — execute() is never reached", async () => {
    const connector = new ExecuteMustNotBeCalledConnector({
      status: "DRIFTED",
      drifted_fields: [{ field_ref: "version", expected: "1.2.3", observed: "1.2.4" }],
    });
    const result = await runGatedExecution(connector, actionDefinition(), { version: "1.3.0" }, preconditions, authorization());

    expect(result.outcome).toBe("BLOCKED_DRIFTED");
    if (result.outcome !== "BLOCKED_DRIFTED") return;
    expect(result.preflightResult.drifted_fields).toEqual([{ field_ref: "version", expected: "1.2.3", observed: "1.2.4" }]);
  });

  it("CRITICAL: UNKNOWN is treated as missing required context, never an implicit pass — execute() is never reached", async () => {
    const connector = new ExecuteMustNotBeCalledConnector({ status: "UNKNOWN", drifted_fields: [] });
    const result = await runGatedExecution(connector, actionDefinition(), { version: "1.3.0" }, preconditions, authorization());

    expect(result.outcome).toBe("BLOCKED_UNKNOWN");
  });

  it("a deliberately staged drift against the SimulatedActionConnector's own preconditions is caught and blocks execution", async () => {
    // Target state was mutated out from under the plan after it was proposed — staged drift.
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["version", "1.2.4"]]), () => NOW);
    const result = await runGatedExecution(connector, actionDefinition(), { version: "1.3.0" }, preconditions, authorization());

    expect(result.outcome).toBe("BLOCKED_DRIFTED");
    // The target must be provably untouched — execute() never ran.
    expect(connector.getTargetState("version")).toBe("1.2.4");
  });

  it("preflight() runs immediately before execute() on every call — order is never reversed", async () => {
    const calls: string[] = [];
    class OrderTrackingConnector implements ActionConnector {
      descriptor(): ConnectorDescriptor {
        return descriptor;
      }
      validateAction(): ValidationResult {
        return { valid: true, errors: [] };
      }
      async preflight(): Promise<PreflightResult> {
        calls.push("preflight");
        return { status: "MATCH", drifted_fields: [] };
      }
      async execute(): Promise<ExecutionResult> {
        calls.push("execute");
        return {
          execution_result_id: "res_1",
          proposal_id: "prop_1",
          action_ref: "restart_service",
          started_at: NOW.toISOString(),
          completed_at: NOW.toISOString(),
          status: "SUCCESS",
          output_summary: "restarted",
          side_effects: { systems_touched: [] },
          error: {},
          rollback_available: false,
          executor_build_hash: "test-build",
        };
      }
    }
    await runGatedExecution(new OrderTrackingConnector(), actionDefinition(), {}, preconditions, authorization());
    expect(calls).toEqual(["preflight", "execute"]);
  });
});
