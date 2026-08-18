import { describe, expect, it } from "vitest";
import type { ExecutionState } from "@aop/contracts";
import { ExecutionStateMachine, type UncertainExitProof } from "./state-machine.js";
import { InMemoryExecutionStateStore } from "./execution-state-store.js";
import { InMemoryPlatformEventEmitter } from "./platform-event-emitter.js";
import { InMemoryEvidenceRecorder } from "./evidence-recorder.js";

/** Builds a fresh machine + a call-order tracker across all three deps (for RULE 7 ordering assertions). */
function buildMachine() {
  const calls: string[] = [];
  const stateStore = new InMemoryExecutionStateStore();
  const eventEmitter = new InMemoryPlatformEventEmitter();
  const evidenceRecorder = new InMemoryEvidenceRecorder();

  const originalSave = stateStore.save.bind(stateStore);
  stateStore.save = async (execution) => {
    calls.push("persist");
    return originalSave(execution);
  };
  const originalEmit = eventEmitter.emit.bind(eventEmitter);
  eventEmitter.emit = async (event) => {
    calls.push("emit");
    return originalEmit(event);
  };
  const originalRecord = evidenceRecorder.record.bind(evidenceRecorder);
  evidenceRecorder.record = async (evidence) => {
    calls.push("evidence");
    return originalRecord(evidence);
  };

  const machine = new ExecutionStateMachine({
    stateStore,
    eventEmitter,
    evidenceRecorder,
    now: () => new Date("2026-08-18T00:00:00.000Z"),
  });

  return { machine, calls, stateStore, eventEmitter, evidenceRecorder };
}

describe("ExecutionStateMachine — deps.now default", () => {
  it("uses the real wall clock when no `now` override is supplied", async () => {
    const before = Date.now();
    const machine = new ExecutionStateMachine({
      stateStore: new InMemoryExecutionStateStore(),
      eventEmitter: new InMemoryPlatformEventEmitter(),
      evidenceRecorder: new InMemoryEvidenceRecorder(),
    });
    const { execution } = await machine.createExecution({
      tenantId: "tenant_1",
      requestId: "req_1",
      opcId: "opc_1",
      opcVersion: "1.0.0",
    });
    const after = Date.now();

    const createdAtMs = new Date(execution.created_at).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(before);
    expect(createdAtMs).toBeLessThanOrEqual(after);
  });
});

describe("ExecutionStateMachine.createExecution", () => {
  it("creates a RECEIVED execution and follows RULE 7's persist -> emit -> evidence order", async () => {
    const { machine, calls } = buildMachine();
    const { execution, created } = await machine.createExecution({
      tenantId: "tenant_1",
      requestId: "req_1",
      opcId: "opc_1",
      opcVersion: "1.0.0",
    });

    expect(created).toBe(true);
    expect(execution.state).toBe("RECEIVED");
    expect(calls).toEqual(["persist", "emit", "evidence"]);
  });

  it("spec §31: re-delivering the same trigger (same tenant_id + request_id) is a true no-op", async () => {
    const { machine, calls, stateStore } = buildMachine();
    const first = await machine.createExecution({
      tenantId: "tenant_1",
      requestId: "req_1",
      opcId: "opc_1",
      opcVersion: "1.0.0",
    });
    calls.length = 0; // reset tracker after the real creation

    const second = await machine.createExecution({
      tenantId: "tenant_1",
      requestId: "req_1",
      opcId: "opc_1",
      opcVersion: "1.0.0",
    });

    expect(second.created).toBe(false);
    expect(second.execution).toEqual(first.execution);
    // No re-persist, re-emit, or re-evidence on the no-op path.
    expect(calls).toEqual([]);
    expect((await stateStore.get("tenant_1", first.execution.execution_id))?.execution_id).toBe(
      first.execution.execution_id,
    );
  });

  it("a different request_id under the same tenant creates a distinct execution", async () => {
    const { machine } = buildMachine();
    const first = await machine.createExecution({ tenantId: "tenant_1", requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    const second = await machine.createExecution({ tenantId: "tenant_1", requestId: "req_2", opcId: "opc_1", opcVersion: "1.0.0" });
    expect(first.execution.execution_id).not.toBe(second.execution.execution_id);
  });
});

describe("ExecutionStateMachine.transitionTo — happy path + RULE 7", () => {
  it("walks the full happy-path graph, each transition following persist -> emit -> evidence", async () => {
    const { machine, calls } = buildMachine();
    const { execution } = await machine.createExecution({ tenantId: "tenant_1", requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    calls.length = 0;

    const path: Array<[ExecutionState["state"], string, "OBSERVATION" | "HYPOTHESIS" | "PLAN" | "APPROVAL" | "ACTION_RESULT" | "VERIFICATION" | "OUTCOME"]> = [
      ["OPC_MATCHED", "opc.matched", "OBSERVATION"],
      ["CONTEXT_ASSEMBLY", "context.assembly.started", "OBSERVATION"],
      ["INVESTIGATING", "investigation.completed", "OBSERVATION"],
      ["DIAGNOSED", "diagnosis.completed", "HYPOTHESIS"],
      ["PLANNED", "plan.created", "PLAN"],
      ["WAITING_APPROVAL", "approval.requested", "APPROVAL"],
      ["EXECUTING", "execution.started", "ACTION_RESULT"],
      ["VERIFYING", "verification.completed", "VERIFICATION"],
      ["RESOLVED", "request.resolved", "OUTCOME"],
    ];

    let executionId = execution.execution_id;
    for (const [toState, eventType, evidenceType] of path) {
      const updated = await machine.transitionTo({
        tenantId: "tenant_1",
        executionId,
        toState,
        eventType,
        evidenceType,
        evidenceSummary: `moved to ${toState}`,
      });
      expect(updated.state).toBe(toState);
      executionId = updated.execution_id;
    }

    // 9 transitions * 3 calls each, always in the same order.
    expect(calls).toHaveLength(27);
    for (let i = 0; i < calls.length; i += 3) {
      expect(calls.slice(i, i + 3)).toEqual(["persist", "emit", "evidence"]);
    }
  });

  it("rejects an illegal transition (e.g. RECEIVED straight to EXECUTING)", async () => {
    const { machine } = buildMachine();
    const { execution } = await machine.createExecution({ tenantId: "tenant_1", requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });

    await expect(
      machine.transitionTo({
        tenantId: "tenant_1",
        executionId: execution.execution_id,
        toState: "EXECUTING",
        eventType: "execution.started",
        evidenceType: "ACTION_RESULT",
        evidenceSummary: "invalid",
      }),
    ).rejects.toThrow(/Illegal transition/);
  });

  it("throws when transitioning an execution that doesn't exist", async () => {
    const { machine } = buildMachine();
    await expect(
      machine.transitionTo({
        tenantId: "tenant_1",
        executionId: "nonexistent",
        toState: "OPC_MATCHED",
        eventType: "opc.matched",
        evidenceType: "OBSERVATION",
        evidenceSummary: "n/a",
      }),
    ).rejects.toThrow(/No execution/);
  });
});

describe("ExecutionStateMachine — EXECUTION_UNCERTAIN's three proof-gated exits (LLD-v1 §4, ADR-004)", () => {
  async function toExecuting(machine: ExecutionStateMachine) {
    const { execution } = await machine.createExecution({ tenantId: "tenant_1", requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });
    let id = execution.execution_id;
    for (const toState of ["OPC_MATCHED", "CONTEXT_ASSEMBLY", "INVESTIGATING", "DIAGNOSED", "PLANNED", "WAITING_APPROVAL", "EXECUTING"] as const) {
      const updated = await machine.transitionTo({
        tenantId: "tenant_1",
        executionId: id,
        toState,
        eventType: "x",
        evidenceType: "OBSERVATION",
        evidenceSummary: "x",
      });
      id = updated.execution_id;
    }
    return id;
  }

  async function toUncertain(machine: ExecutionStateMachine) {
    const executionId = await toExecuting(machine);
    await machine.transitionTo({
      tenantId: "tenant_1",
      executionId,
      toState: "EXECUTION_UNCERTAIN",
      eventType: "execution.uncertain",
      evidenceType: "OBSERVATION",
      evidenceSummary: "worker restarted mid-execution, marker ATTEMPTED",
    });
    return executionId;
  }

  it("CRITICAL: operation_did_not_occur proof -> EXECUTING (safe retry, same operation_id)", async () => {
    const { machine } = buildMachine();
    const executionId = await toUncertain(machine);
    const proof: UncertainExitProof = { kind: "operation_did_not_occur", operation_id: "op_1" };

    const updated = await machine.transitionTo({
      tenantId: "tenant_1",
      executionId,
      toState: "EXECUTING",
      eventType: "execution.retried",
      evidenceType: "OBSERVATION",
      evidenceSummary: "status-check proved operation did not occur",
      uncertainExitProof: proof,
    });
    expect(updated.state).toBe("EXECUTING");
  });

  it("CRITICAL: operation_completed proof -> VERIFYING (status check proves operation DID complete)", async () => {
    const { machine } = buildMachine();
    const executionId = await toUncertain(machine);
    const proof: UncertainExitProof = { kind: "operation_completed", operation_id: "op_1" };

    const updated = await machine.transitionTo({
      tenantId: "tenant_1",
      executionId,
      toState: "VERIFYING",
      eventType: "execution.completed",
      evidenceType: "VERIFICATION",
      evidenceSummary: "status-check proved operation completed",
      uncertainExitProof: proof,
    });
    expect(updated.state).toBe("VERIFYING");
  });

  it("CRITICAL: inconclusive_not_idempotent proof -> ESCALATED_HUMAN_OVERRIDE", async () => {
    const { machine } = buildMachine();
    const executionId = await toUncertain(machine);
    const proof: UncertainExitProof = { kind: "inconclusive_not_idempotent", operation_id: "op_1", reason: "connector timeout on status-check" };

    const updated = await machine.transitionTo({
      tenantId: "tenant_1",
      executionId,
      toState: "ESCALATED_HUMAN_OVERRIDE",
      eventType: "request.escalated",
      evidenceType: "OUTCOME",
      evidenceSummary: "status-check inconclusive and not provably idempotent",
      uncertainExitProof: proof,
    });
    expect(updated.state).toBe("ESCALATED_HUMAN_OVERRIDE");
  });

  it("CRITICAL: leaving EXECUTION_UNCERTAIN with no proof throws — no default/timeout fallback (ADR-004)", async () => {
    const { machine } = buildMachine();
    const executionId = await toUncertain(machine);

    await expect(
      machine.transitionTo({
        tenantId: "tenant_1",
        executionId,
        toState: "VERIFYING",
        eventType: "execution.completed",
        evidenceType: "VERIFICATION",
        evidenceSummary: "no proof supplied",
      }),
    ).rejects.toThrow(/requires an uncertainExitProof/);
  });

  it("CRITICAL: a proof/target-state mismatch throws — proof kind must match the LLD §4 diagram exactly", async () => {
    const { machine } = buildMachine();
    const executionId = await toUncertain(machine);
    const wrongProof: UncertainExitProof = { kind: "operation_did_not_occur", operation_id: "op_1" };

    await expect(
      machine.transitionTo({
        tenantId: "tenant_1",
        executionId,
        toState: "VERIFYING", // operation_did_not_occur proves EXECUTING, not VERIFYING
        eventType: "execution.completed",
        evidenceType: "VERIFICATION",
        evidenceSummary: "mismatched proof",
        uncertainExitProof: wrongProof,
      }),
    ).rejects.toThrow(/proves an exit to EXECUTING, not VERIFYING/);
  });

  it("rejects a fourth, undiagrammed exit from EXECUTION_UNCERTAIN (e.g. straight to FAILED)", async () => {
    const { machine } = buildMachine();
    const executionId = await toUncertain(machine);

    await expect(
      machine.transitionTo({
        tenantId: "tenant_1",
        executionId,
        toState: "FAILED",
        eventType: "x",
        evidenceType: "OUTCOME",
        evidenceSummary: "x",
        uncertainExitProof: { kind: "operation_did_not_occur", operation_id: "op_1" },
      }),
    ).rejects.toThrow(/Illegal transition/);
  });

  it("rejects an uncertainExitProof passed on a transition NOT leaving EXECUTION_UNCERTAIN", async () => {
    const { machine } = buildMachine();
    const { execution } = await machine.createExecution({ tenantId: "tenant_1", requestId: "req_1", opcId: "opc_1", opcVersion: "1.0.0" });

    await expect(
      machine.transitionTo({
        tenantId: "tenant_1",
        executionId: execution.execution_id,
        toState: "OPC_MATCHED",
        eventType: "opc.matched",
        evidenceType: "OBSERVATION",
        evidenceSummary: "x",
        uncertainExitProof: { kind: "operation_completed", operation_id: "op_1" },
      }),
    ).rejects.toThrow(/only valid when leaving EXECUTION_UNCERTAIN/);
  });

  it("EXECUTING -> EXECUTION_UNCERTAIN -> EXECUTING -> VERIFYING models a real retry-then-succeed sequence", async () => {
    const { machine } = buildMachine();
    const executionId = await toUncertain(machine);

    const retried = await machine.transitionTo({
      tenantId: "tenant_1",
      executionId,
      toState: "EXECUTING",
      eventType: "execution.retried",
      evidenceType: "OBSERVATION",
      evidenceSummary: "retry",
      uncertainExitProof: { kind: "operation_did_not_occur", operation_id: "op_1" },
    });
    expect(retried.state).toBe("EXECUTING");

    const verified = await machine.transitionTo({
      tenantId: "tenant_1",
      executionId: retried.execution_id,
      toState: "VERIFYING",
      eventType: "execution.completed",
      evidenceType: "VERIFICATION",
      evidenceSummary: "normal completion after retry",
    });
    expect(verified.state).toBe("VERIFYING");
  });
});
