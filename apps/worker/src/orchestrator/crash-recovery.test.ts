import { describe, expect, it } from "vitest";
import type { ActionDefinition, ConnectorDescriptor, ExecutionAuthorization, StatusCheckResult } from "@aop/contracts";
import { EnvVarSecretResolver } from "@aop/secrets";
import {
  InMemoryExecutionStepMarkerStore,
  SimulatedActionConnector,
  deriveOperationId,
  runGatedExecution,
  type ActionConnector,
  type ValidationResult,
} from "@aop/action-executor";
import { ExecutionStateMachine } from "./state-machine.js";
import { InMemoryExecutionStateStore } from "./execution-state-store.js";
import { InMemoryPlatformEventEmitter } from "./platform-event-emitter.js";
import { InMemoryEvidenceRecorder } from "./evidence-recorder.js";
import { beginTrackedExecution, completeTrackedExecution, recoverUncertainExecution } from "./crash-recovery.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const TENANT = "tenant_1";
const secretResolver = new EnvVarSecretResolver({ SIM_ACTION_KEY: "sk-fixture-secret" });

const connectorDescriptor: ConnectorDescriptor = {
  connector_id: "sim-action-connector",
  tenant_id: TENANT,
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

function restartAction(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    action_id: "restart_service",
    version: "1.0.0",
    tenant_id: TENANT,
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

function authorization(): ExecutionAuthorization {
  return {
    authorization_id: "auth_1",
    proposal_id: "prop_1",
    policy_decision_id: "dec_1",
    identity: { mode: "ON_BEHALF_OF", acting_as: { id: "user_approver", type: "human" }, approver_ref: "user_approver", requester_ref: "user_proposer" },
    delegation: { token_type: "none", scopes: [], issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 15 * 60 * 1000).toISOString() },
    signed_plan_hash: "sha256:x",
    issued_by: "approval-acceptance-gate",
    created_at: NOW.toISOString(),
  };
}

/** A connector whose statusCheck() answer is entirely canned — used to unit-test recoverUncertainExecution()'s branches in isolation. */
class CannedStatusCheckConnector implements ActionConnector {
  constructor(private readonly result: StatusCheckResult, private readonly isIdempotent = false) {}
  descriptor(): ConnectorDescriptor {
    return { ...connectorDescriptor, is_idempotent: this.isIdempotent };
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
  async statusCheck(): Promise<StatusCheckResult> {
    return this.result;
  }
}

function buildHarness() {
  const stateStore = new InMemoryExecutionStateStore();
  const eventEmitter = new InMemoryPlatformEventEmitter();
  const evidenceRecorder = new InMemoryEvidenceRecorder();
  const stateMachine = new ExecutionStateMachine({ stateStore, eventEmitter, evidenceRecorder, now: () => NOW });
  const markerStore = new InMemoryExecutionStepMarkerStore();
  return { stateStore, eventEmitter, evidenceRecorder, stateMachine, markerStore };
}

/** Drives a fresh execution to WAITING_APPROVAL via legal transitions — the precondition beginTrackedExecution() needs. */
async function driveToWaitingApproval(stateMachine: ExecutionStateMachine, executionId: string): Promise<void> {
  for (const toState of ["OPC_MATCHED", "CONTEXT_ASSEMBLY", "INVESTIGATING", "DIAGNOSED", "PLANNED", "WAITING_APPROVAL"] as const) {
    await stateMachine.transitionTo({
      tenantId: TENANT,
      executionId,
      toState,
      eventType: `test.${toState}`,
      evidenceType: "OUTCOME",
      evidenceSummary: `driven to ${toState} for test setup`,
    });
  }
}

describe("beginTrackedExecution() — marker + pre-execute state write (D-07, AC1/AC2)", () => {
  it("CRITICAL: writes the marker (ATTEMPTED, attempt 1) and transitions to EXECUTING before any connector call happens", async () => {
    const { stateStore, stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);

    const connector = new SimulatedActionConnector(connectorDescriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const result = await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    expect(result.execution.state).toBe("EXECUTING");
    expect(result.marker.status).toBe("ATTEMPTED");
    expect(result.marker.attempt_number).toBe(1);

    const persistedExecution = await stateStore.get(TENANT, execution.execution_id);
    expect(persistedExecution?.state).toBe("EXECUTING");
    const persistedMarker = await markerStore.get(TENANT, execution.execution_id, "step_1");
    expect(persistedMarker?.operation_id).toBe(result.operationId);
  });

  it("defaults `now` to the real wall clock when not injected", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new SimulatedActionConnector(connectorDescriptor, secretResolver, new Map(), () => NOW);

    const before = Date.now();
    const result = await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
    });
    const after = Date.now();

    const createdAtMs = new Date(result.marker.created_at).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(before);
    expect(createdAtMs).toBeLessThanOrEqual(after);
  });

  it("AC2: operation_id is stable — deriving it again for the same (tenant, execution, step, action_version) matches exactly", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);

    const connector = new SimulatedActionConnector(connectorDescriptor, secretResolver, new Map(), () => NOW);
    const result = await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const rederived = deriveOperationId(TENANT, execution.execution_id, "step_1", "1.0.0");
    expect(result.operationId).toBe(rederived);
  });
});

describe("completeTrackedExecution() — normal-path completion (D-07)", () => {
  it("marks the marker COMPLETED and transitions EXECUTING -> VERIFYING", async () => {
    const { stateStore, stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);

    const connector = new SimulatedActionConnector(connectorDescriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const begun = await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const gated = await runGatedExecution(
      connector,
      restartAction(),
      { version: "1.3.0" },
      { checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }] },
      authorization(),
      begun.operationId,
    );
    expect(gated.outcome).toBe("EXECUTED");
    if (gated.outcome !== "EXECUTED") return;

    const completedExecution = await completeTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      executionResultId: gated.executionResult.execution_result_id,
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    expect(completedExecution.state).toBe("VERIFYING");
    const persistedMarker = await markerStore.get(TENANT, execution.execution_id, "step_1");
    expect(persistedMarker?.status).toBe("COMPLETED");

    const persistedExecution = await stateStore.get(TENANT, execution.execution_id);
    expect(persistedExecution?.state).toBe("VERIFYING");
  });

  it("throws when no marker exists for the given step", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await expect(
      completeTrackedExecution({
        tenantId: TENANT,
        executionId: execution.execution_id,
        stepId: "never_begun",
        executionResultId: "res_1",
        markerStore,
        stateMachine,
        now: () => NOW,
      }),
    ).rejects.toThrow(/No execution_step_marker/);
  });

  it("defaults `now` to the real wall clock when not injected", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new SimulatedActionConnector(connectorDescriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const before = Date.now();
    const completed = await completeTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      executionResultId: "res_1",
      markerStore,
      stateMachine,
    });
    const after = Date.now();

    expect(completed.state).toBe("VERIFYING");
    const completedAtMs = new Date((await markerStore.get(TENANT, execution.execution_id, "step_1"))!.completed_at!).getTime();
    expect(completedAtMs).toBeGreaterThanOrEqual(before);
    expect(completedAtMs).toBeLessThanOrEqual(after);
  });
});

describe("recoverUncertainExecution() — LLD-v1 §7.2's crash-recovery sequence, exactly (D-07, AC3/AC4)", () => {
  it("throws when no marker exists for the given step", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    const connector = new CannedStatusCheckConnector({ outcome: "CONFIRMED_EXECUTED" });
    await expect(
      recoverUncertainExecution({ tenantId: TENANT, executionId: execution.execution_id, stepId: "step_1", connector, markerStore, stateMachine, now: () => NOW }),
    ).rejects.toThrow(/No execution_step_marker/);
  });

  it("throws when the marker is already COMPLETED — recovery only applies to a genuinely uncertain outcome", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new SimulatedActionConnector(connectorDescriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const begun = await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });
    await markerStore.save({ ...begun.marker, status: "COMPLETED", completed_at: NOW.toISOString() });

    await expect(
      recoverUncertainExecution({ tenantId: TENANT, executionId: execution.execution_id, stepId: "step_1", connector, markerStore, stateMachine, now: () => NOW }),
    ).rejects.toThrow(/already "COMPLETED"/);
  });

  it("CONFIRMED_NOT_EXECUTED -> RETRY, marker attempt incremented, EXECUTION_UNCERTAIN -> EXECUTING, same operation_id reused", async () => {
    const { stateStore, stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new CannedStatusCheckConnector({ outcome: "CONFIRMED_NOT_EXECUTED" });
    const begun = await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const result = await recoverUncertainExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      connector,
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    expect(result.outcome).toBe("RETRY");
    if (result.outcome !== "RETRY") return;
    expect(result.operationId).toBe(begun.operationId);
    expect(result.attemptNumber).toBe(2);
    expect(result.execution.state).toBe("EXECUTING");

    const persistedExecution = await stateStore.get(TENANT, execution.execution_id);
    expect(persistedExecution?.state).toBe("EXECUTING");
    const persistedMarker = await markerStore.get(TENANT, execution.execution_id, "step_1");
    expect(persistedMarker?.attempt_number).toBe(2);
    expect(persistedMarker?.status).toBe("ATTEMPTED");
  });

  it("CONFIRMED_EXECUTED -> COMPLETED, marker marked COMPLETED, EXECUTION_UNCERTAIN -> VERIFYING", async () => {
    const { stateStore, stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new CannedStatusCheckConnector({ outcome: "CONFIRMED_EXECUTED" });
    await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const result = await recoverUncertainExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      connector,
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    expect(result.outcome).toBe("COMPLETED");
    if (result.outcome !== "COMPLETED") return;
    expect(result.execution.state).toBe("VERIFYING");

    const persistedExecution = await stateStore.get(TENANT, execution.execution_id);
    expect(persistedExecution?.state).toBe("VERIFYING");
    const persistedMarker = await markerStore.get(TENANT, execution.execution_id, "step_1");
    expect(persistedMarker?.status).toBe("COMPLETED");
  });

  it("INCONCLUSIVE + provably idempotent connector -> RETRY (safe retry, proven)", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new CannedStatusCheckConnector({ outcome: "INCONCLUSIVE", detail: "connector timeout" }, true);
    await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const result = await recoverUncertainExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      connector,
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    expect(result.outcome).toBe("RETRY");
    if (result.outcome !== "RETRY") return;
    expect(result.execution.state).toBe("EXECUTING");
  });

  it("CRITICAL (ADR-004 fail-closed rule): INCONCLUSIVE + NOT provably idempotent -> ESCALATED_HUMAN_OVERRIDE, never an automatic retry", async () => {
    const { stateStore, stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new CannedStatusCheckConnector({ outcome: "INCONCLUSIVE", detail: "connector timeout" }, false);
    const begun = await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const result = await recoverUncertainExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      connector,
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    expect(result.outcome).toBe("ESCALATED");
    if (result.outcome !== "ESCALATED") return;
    expect(result.execution.state).toBe("ESCALATED_HUMAN_OVERRIDE");

    const persistedExecution = await stateStore.get(TENANT, execution.execution_id);
    expect(persistedExecution?.state).toBe("ESCALATED_HUMAN_OVERRIDE");
    // No retry attempted: the marker's attempt_number is untouched.
    const persistedMarker = await markerStore.get(TENANT, execution.execution_id, "step_1");
    expect(persistedMarker?.attempt_number).toBe(begun.marker.attempt_number);
    expect(persistedMarker?.status).toBe("ATTEMPTED");
  });

  it("INCONCLUSIVE with no detail string still produces a valid escalation (fallback reason text)", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new CannedStatusCheckConnector({ outcome: "INCONCLUSIVE" }, false); // no detail
    await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const result = await recoverUncertainExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      connector,
      markerStore,
      stateMachine,
      now: () => NOW,
    });
    expect(result.outcome).toBe("ESCALATED");
  });

  it("INCONCLUSIVE + idempotent with no detail string still produces a valid retry (fallback reason text)", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new CannedStatusCheckConnector({ outcome: "INCONCLUSIVE" }, true); // no detail
    await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const result = await recoverUncertainExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      connector,
      markerStore,
      stateMachine,
      now: () => NOW,
    });
    expect(result.outcome).toBe("RETRY");
  });

  it("defaults `now` to the real wall clock when not injected", async () => {
    const { stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);
    const connector = new CannedStatusCheckConnector({ outcome: "CONFIRMED_NOT_EXECUTED" });
    await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    const result = await recoverUncertainExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      connector,
      markerStore,
      stateMachine,
    });
    expect(result.outcome).toBe("RETRY");
  });

  it("CRITICAL: a full simulated crash mid-flight — genuine SimulatedActionConnector, begin -> (crash before complete) -> recover -> CONFIRMED_EXECUTED -> VERIFYING", async () => {
    const { stateStore, stateMachine, markerStore } = buildHarness();
    const { execution } = await stateMachine.createExecution({ tenantId: TENANT, requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    await driveToWaitingApproval(stateMachine, execution.execution_id);

    const connector = new SimulatedActionConnector(connectorDescriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
    const begun = await beginTrackedExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      action: restartAction(),
      connector,
      connectorVersion: "1.0.0",
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    // Genuinely executes against the simulated target (the connector really
    // did the work) — but the orchestrator "crashes" before ever calling
    // completeTrackedExecution(), so the marker is left ATTEMPTED and the
    // ExecutionState is left at EXECUTING, exactly like a real restart.
    const gated = await runGatedExecution(
      connector,
      restartAction(),
      { version: "1.3.0" },
      { checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }] },
      authorization(),
      begun.operationId,
    );
    expect(gated.outcome).toBe("EXECUTED");
    expect(connector.getTargetState("version")).toBe("1.3.0"); // the mutation genuinely happened

    // *** simulated crash — no completeTrackedExecution() call ***

    // (restart) recovery runs, using the SAME operation_id from the marker.
    const recovered = await recoverUncertainExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      stepId: "step_1",
      connector,
      markerStore,
      stateMachine,
      now: () => NOW,
    });

    expect(recovered.outcome).toBe("COMPLETED");
    if (recovered.outcome !== "COMPLETED") return;
    expect(recovered.execution.state).toBe("VERIFYING");

    const persistedExecution = await stateStore.get(TENANT, execution.execution_id);
    expect(persistedExecution?.state).toBe("VERIFYING");
    const persistedMarker = await markerStore.get(TENANT, execution.execution_id, "step_1");
    expect(persistedMarker?.status).toBe("COMPLETED");
  });
});
