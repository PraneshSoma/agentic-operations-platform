import { randomUUID } from "node:crypto";
import { ExecutionStepMarkerSchema, type ActionDefinition, type ExecutionState, type ExecutionStepMarker } from "@aop/contracts";
import { deriveOperationId, type ActionConnector, type ExecutionStepMarkerStore } from "@aop/action-executor";
import type { ExecutionStateMachine } from "./state-machine.js";

/**
 * Crash-recovery marker + status-check, end-to-end (D-07, LLD-v1 §2/§7.2,
 * ADR-004). Three functions matching the LLD sequence's two annotated
 * transaction boundaries plus the recovery branch:
 *
 *   1. `beginTrackedExecution()` — the marker insert "in the same
 *      transaction as the pre-execute state write, before the connector
 *      call." Derives the stable operation_id, writes the marker
 *      (ATTEMPTED, attempt_number=1), then transitions WAITING_APPROVAL
 *      -> EXECUTING. The caller invokes `runGatedExecution()` (D-02)
 *      with the returned operationId immediately after — this function
 *      never calls the connector itself.
 *   2. `completeTrackedExecution()` — the normal-path completion: marks
 *      the marker COMPLETED "in the same transaction as the VERIFYING
 *      transition + evidence write," then transitions EXECUTING ->
 *      VERIFYING.
 *   3. `recoverUncertainExecution()` — LLD-v1 §7.2's crash-recovery
 *      sequence, exactly: on restart with a marker still ATTEMPTED,
 *      transitions to EXECUTION_UNCERTAIN, runs the connector's
 *      mandatory `statusCheck()` against the SAME operation_id, and
 *      branches per ADR-004's fail-closed decision tree.
 *
 * "Same transaction" is approximated here (no real DB transaction exists
 * yet — E-01 wires the real backing store) the same way state-machine.ts
 * already approximates RULE 7's persist/emit/evidence ordering: the
 * marker write and the paired state transition are sequenced directly
 * one after the other, with nothing else able to run between them.
 */

export interface BeginTrackedExecutionInput {
  tenantId: string;
  executionId: string;
  stepId: string;
  action: ActionDefinition;
  connector: ActionConnector;
  connectorVersion: string;
  markerStore: ExecutionStepMarkerStore;
  stateMachine: ExecutionStateMachine;
  now?: () => Date;
}

export interface BeginTrackedExecutionResult {
  operationId: string;
  execution: ExecutionState;
  marker: ExecutionStepMarker;
}

export async function beginTrackedExecution(input: BeginTrackedExecutionInput): Promise<BeginTrackedExecutionResult> {
  const now = input.now?.() ?? new Date();
  const operationId = deriveOperationId(input.tenantId, input.executionId, input.stepId, input.action.version);

  const marker = ExecutionStepMarkerSchema.parse({
    marker_id: randomUUID(),
    tenant_id: input.tenantId,
    execution_id: input.executionId,
    step_id: input.stepId,
    operation_id: operationId,
    action_ref: input.action.action_id,
    action_version: input.action.version,
    connector_ref: input.connector.descriptor().connector_id,
    connector_version: input.connectorVersion,
    attempt_number: 1,
    status: "ATTEMPTED",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });

  // Marker written BEFORE the state transition, which is written BEFORE
  // any connector call — the caller only gets operationId back after
  // both of these have happened.
  await input.markerStore.save(marker);
  const execution = await input.stateMachine.transitionTo({
    tenantId: input.tenantId,
    executionId: input.executionId,
    toState: "EXECUTING",
    eventType: "execution.started",
    evidenceType: "ACTION_RESULT",
    evidenceSummary: `Execution attempt started for step "${input.stepId}" (operation_id "${operationId}", attempt 1)`,
    structuredData: { operation_id: operationId, step_id: input.stepId, attempt_number: 1 },
  });

  return { operationId, execution, marker };
}

export interface CompleteTrackedExecutionInput {
  tenantId: string;
  executionId: string;
  stepId: string;
  executionResultId: string;
  markerStore: ExecutionStepMarkerStore;
  stateMachine: ExecutionStateMachine;
  now?: () => Date;
}

export async function completeTrackedExecution(input: CompleteTrackedExecutionInput): Promise<ExecutionState> {
  const now = input.now?.() ?? new Date();
  const marker = await input.markerStore.get(input.tenantId, input.executionId, input.stepId);
  if (!marker) {
    throw new Error(
      `No execution_step_marker for (tenant "${input.tenantId}", execution "${input.executionId}", step "${input.stepId}") — ` +
        `completeTrackedExecution() requires beginTrackedExecution() to have run first`,
    );
  }

  await input.markerStore.save({ ...marker, status: "COMPLETED", completed_at: now.toISOString(), updated_at: now.toISOString() });

  return input.stateMachine.transitionTo({
    tenantId: input.tenantId,
    executionId: input.executionId,
    toState: "VERIFYING",
    eventType: "execution.completed",
    evidenceType: "ACTION_RESULT",
    evidenceSummary: `Execution completed for step "${input.stepId}" (execution_result_id "${input.executionResultId}")`,
    structuredData: { operation_id: marker.operation_id, execution_result_id: input.executionResultId },
  });
}

export interface RecoverUncertainExecutionInput {
  tenantId: string;
  executionId: string;
  stepId: string;
  connector: ActionConnector;
  markerStore: ExecutionStepMarkerStore;
  stateMachine: ExecutionStateMachine;
  now?: () => Date;
}

export type RecoveryOutcome =
  | { outcome: "RETRY"; execution: ExecutionState; operationId: string; attemptNumber: number }
  | { outcome: "COMPLETED"; execution: ExecutionState }
  | { outcome: "ESCALATED"; execution: ExecutionState };

export async function recoverUncertainExecution(input: RecoverUncertainExecutionInput): Promise<RecoveryOutcome> {
  const now = input.now?.() ?? new Date();
  const marker = await input.markerStore.get(input.tenantId, input.executionId, input.stepId);
  if (!marker) {
    throw new Error(
      `No execution_step_marker for (tenant "${input.tenantId}", execution "${input.executionId}", step "${input.stepId}") — ` +
        `cannot recover an uncertain execution without one`,
    );
  }
  if (marker.status !== "ATTEMPTED") {
    throw new Error(
      `Marker for (tenant "${input.tenantId}", execution "${input.executionId}", step "${input.stepId}") is already ` +
        `"${marker.status}" — recoverUncertainExecution() only applies to a marker still ATTEMPTED (a genuinely uncertain outcome)`,
    );
  }

  // "(restart) find marker ATTEMPTED, no completed transition -> transition to EXECUTION_UNCERTAIN"
  await input.stateMachine.transitionTo({
    tenantId: input.tenantId,
    executionId: input.executionId,
    toState: "EXECUTION_UNCERTAIN",
    eventType: "execution.uncertain",
    evidenceType: "OUTCOME",
    evidenceSummary: `Execution for step "${input.stepId}" found ATTEMPTED with no confirmed completion — entering EXECUTION_UNCERTAIN (operation_id "${marker.operation_id}")`,
    structuredData: { operation_id: marker.operation_id, attempt_number: marker.attempt_number },
  });

  // The mandatory status check (ADR-004) — same operation_id, same
  // action_version/connector_version recorded on the marker, never
  // regenerated or guessed at.
  const statusResult = await input.connector.statusCheck(marker.operation_id, marker.action_version, marker.connector_version);

  if (statusResult.outcome === "CONFIRMED_NOT_EXECUTED") {
    const attemptNumber = marker.attempt_number + 1;
    await input.markerStore.save({ ...marker, attempt_number: attemptNumber, status: "ATTEMPTED", updated_at: now.toISOString() });
    const execution = await input.stateMachine.transitionTo({
      tenantId: input.tenantId,
      executionId: input.executionId,
      toState: "EXECUTING",
      eventType: "execution.retry",
      evidenceType: "OUTCOME",
      evidenceSummary: `Status check proved operation "${marker.operation_id}" did NOT occur — safe retry, attempt ${attemptNumber}`,
      uncertainExitProof: { kind: "operation_did_not_occur", operation_id: marker.operation_id },
    });
    return { outcome: "RETRY", execution, operationId: marker.operation_id, attemptNumber };
  }

  if (statusResult.outcome === "CONFIRMED_EXECUTED") {
    await input.markerStore.save({ ...marker, status: "COMPLETED", completed_at: now.toISOString(), updated_at: now.toISOString() });
    const execution = await input.stateMachine.transitionTo({
      tenantId: input.tenantId,
      executionId: input.executionId,
      toState: "VERIFYING",
      eventType: "execution.completed",
      evidenceType: "OUTCOME",
      evidenceSummary: `Status check proved operation "${marker.operation_id}" completed successfully`,
      uncertainExitProof: { kind: "operation_completed", operation_id: marker.operation_id },
    });
    return { outcome: "COMPLETED", execution };
  }

  // INCONCLUSIVE — ADR-004's fail-closed decision tree: never an implicit
  // pass, never an implicit retry, unless idempotency PROVES retrying is
  // safe regardless of whether the original attempt actually happened.
  if (input.connector.descriptor().is_idempotent) {
    const attemptNumber = marker.attempt_number + 1;
    await input.markerStore.save({ ...marker, attempt_number: attemptNumber, status: "ATTEMPTED", updated_at: now.toISOString() });
    const execution = await input.stateMachine.transitionTo({
      tenantId: input.tenantId,
      executionId: input.executionId,
      toState: "EXECUTING",
      eventType: "execution.retry",
      evidenceType: "OUTCOME",
      evidenceSummary: `Status check inconclusive for operation "${marker.operation_id}" — connector is provably idempotent, safe retry, attempt ${attemptNumber}`,
      uncertainExitProof: {
        kind: "inconclusive_idempotent_retry",
        operation_id: marker.operation_id,
        reason: statusResult.detail ?? "status check inconclusive",
      },
    });
    return { outcome: "RETRY", execution, operationId: marker.operation_id, attemptNumber };
  }

  // CRITICAL (AC: "automatic retry is prohibited when status is
  // inconclusive and the action is not provably idempotent"): no marker
  // mutation, no retry — escalate to a human, full stop.
  const execution = await input.stateMachine.transitionTo({
    tenantId: input.tenantId,
    executionId: input.executionId,
    toState: "ESCALATED_HUMAN_OVERRIDE",
    eventType: "execution.escalated",
    evidenceType: "OUTCOME",
    evidenceSummary: `Status check inconclusive for operation "${marker.operation_id}" and the connector is NOT provably idempotent — escalating per ADR-004's fail-closed rule, no automatic retry attempted`,
    uncertainExitProof: {
      kind: "inconclusive_not_idempotent",
      operation_id: marker.operation_id,
      reason: statusResult.detail ?? "status check inconclusive",
    },
  });
  return { outcome: "ESCALATED", execution };
}
