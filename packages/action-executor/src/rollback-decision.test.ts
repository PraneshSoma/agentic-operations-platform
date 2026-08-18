import { describe, expect, it } from "vitest";
import type {
  ActionDefinition,
  ConnectorDescriptor,
  ExecutionAuthorization,
  ExecutionResult,
  VerificationResult,
} from "@aop/contracts";
import { EnvVarSecretResolver } from "@aop/secrets";
import type { ActionConnector, ValidationResult } from "./action-connector.js";
import { runRollbackDecision } from "./rollback-decision.js";
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

function executionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    execution_result_id: "res_1",
    proposal_id: "prop_1",
    action_ref: "restart_service",
    started_at: NOW.toISOString(),
    completed_at: NOW.toISOString(),
    status: "SUCCESS",
    output_summary: "restarted",
    side_effects: { systems_touched: ["sim-action-connector"] },
    error: {},
    rollback_available: true,
    executor_build_hash: "sha256:test-build",
    ...overrides,
  };
}

function verificationResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    verification_id: "ver_1",
    execution_result_id: "res_1",
    checks: [{ name: "PRODUCTION_EVIDENCE", status: "FAIL", evidence_ids: [] }],
    overall: "FAILED",
    recommended_next_step: "ROLLBACK",
    ...overrides,
  };
}

/** A connector whose rollback() throws if ever reached — proves runRollbackDecision() never calls it when it shouldn't. */
class RollbackMustNotBeCalledConnector implements ActionConnector {
  descriptor(): ConnectorDescriptor {
    return descriptor;
  }
  validateAction(): ValidationResult {
    return { valid: true, errors: [] };
  }
  async preflight(): Promise<never> {
    throw new Error("not used in this test");
  }
  async execute(): Promise<never> {
    throw new Error("not used in this test");
  }
  async rollback(): Promise<ExecutionResult> {
    throw new Error("rollback() must never be called — this is the bug D-04 exists to prevent");
  }
}

describe("runRollbackDecision() — three-class compensation gate (D-04, F-14, ADR-001)", () => {
  it("REVERSIBLE + ROLLBACK recommended -> genuinely rolls back via connector.rollback(), state reverts", async () => {
    const connector = new SimulatedActionConnector(descriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const executed = await connector.execute(actionDefinition(), { version: "1.3.0" }, authorization());
    expect(connector.getTargetState("version")).toBe("1.3.0");

    const result = await runRollbackDecision(
      connector,
      actionDefinition({ compensation_class: "REVERSIBLE", reversible: true }),
      verificationResult(),
      executed,
      authorization(),
    );

    expect(result.outcome).toBe("ROLLED_BACK");
    expect(connector.getTargetState("version")).toBe("1.2.3");
  });

  it("CRITICAL: IRREVERSIBLE never attempts rollback, even when ROLLBACK is (incorrectly) recommended — connector.rollback() is never reached", async () => {
    const connector = new RollbackMustNotBeCalledConnector();
    await expect(
      runRollbackDecision(
        connector,
        actionDefinition({ compensation_class: "IRREVERSIBLE", reversible: false }),
        verificationResult({ recommended_next_step: "ROLLBACK" }),
        executionResult(),
        authorization(),
      ),
    ).rejects.toThrow(/IRREVERSIBLE/);
  });

  it("CRITICAL: IRREVERSIBLE + verification correctly recommends ESCALATE -> NOT_ATTEMPTED, reason IRREVERSIBLE, escalates directly", async () => {
    const connector = new RollbackMustNotBeCalledConnector();
    const result = await runRollbackDecision(
      connector,
      actionDefinition({ compensation_class: "IRREVERSIBLE", reversible: false }),
      verificationResult({ overall: "FAILED", recommended_next_step: "ESCALATE" }),
      executionResult(),
      authorization(),
    );
    expect(result).toEqual({ outcome: "NOT_ATTEMPTED", reason: "IRREVERSIBLE" });
  });

  it("COMPENSATABLE + ROLLBACK recommended -> COMPENSATION_REQUIRED, never calls connector.rollback() directly", async () => {
    const connector = new RollbackMustNotBeCalledConnector();
    const result = await runRollbackDecision(
      connector,
      actionDefinition({ compensation_class: "COMPENSATABLE", reversible: false }),
      verificationResult({ recommended_next_step: "ROLLBACK" }),
      executionResult(),
      authorization(),
    );
    expect(result).toEqual({ outcome: "COMPENSATION_REQUIRED" });
  });

  it("recommended_next_step CLOSE -> NOT_ATTEMPTED, reason NO_ROLLBACK_RECOMMENDED", async () => {
    const connector = new RollbackMustNotBeCalledConnector();
    const result = await runRollbackDecision(
      connector,
      actionDefinition({ compensation_class: "REVERSIBLE" }),
      verificationResult({ overall: "VERIFIED", recommended_next_step: "CLOSE" }),
      executionResult(),
      authorization(),
    );
    expect(result).toEqual({ outcome: "NOT_ATTEMPTED", reason: "NO_ROLLBACK_RECOMMENDED" });
  });

  it("recommended_next_step ESCALATE for a REVERSIBLE action -> NOT_ATTEMPTED, never rolls back", async () => {
    const connector = new RollbackMustNotBeCalledConnector();
    const result = await runRollbackDecision(
      connector,
      actionDefinition({ compensation_class: "REVERSIBLE" }),
      verificationResult({ overall: "INCONCLUSIVE", recommended_next_step: "ESCALATE" }),
      executionResult(),
      authorization(),
    );
    expect(result).toEqual({ outcome: "NOT_ATTEMPTED", reason: "NO_ROLLBACK_RECOMMENDED" });
  });

  it("throws when a REVERSIBLE action's connector doesn't implement rollback() at all", async () => {
    class NoRollbackConnector implements ActionConnector {
      descriptor(): ConnectorDescriptor {
        return descriptor;
      }
      validateAction(): ValidationResult {
        return { valid: true, errors: [] };
      }
      async preflight(): Promise<never> {
        throw new Error("not used");
      }
      async execute(): Promise<never> {
        throw new Error("not used");
      }
      // no rollback() at all — it's optional on the interface
    }
    await expect(
      runRollbackDecision(
        new NoRollbackConnector(),
        actionDefinition({ compensation_class: "REVERSIBLE" }),
        verificationResult({ recommended_next_step: "ROLLBACK" }),
        executionResult(),
        authorization(),
      ),
    ).rejects.toThrow(/does not implement rollback/);
  });
});
