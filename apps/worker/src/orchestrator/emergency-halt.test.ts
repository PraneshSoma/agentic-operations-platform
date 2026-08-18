import { describe, expect, it } from "vitest";
import type { ExecutionState, HaltRequest } from "@aop/contracts";
import { LocalDevIdentityResolver } from "@aop/identity";
import { ExecutionStateMachine } from "./state-machine.js";
import { InMemoryExecutionStateStore } from "./execution-state-store.js";
import { InMemoryPlatformEventEmitter } from "./platform-event-emitter.js";
import { InMemoryEvidenceRecorder } from "./evidence-recorder.js";
import { haltExecution } from "./emergency-halt.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const TENANT = "tenant_1";
const REQUIRED_HALT_ROLES = ["senior_oncall", "platform_owner"];

function haltRequest(overrides: Partial<HaltRequest> = {}): HaltRequest {
  return {
    actor: { id: "user_oncall", role: "senior_oncall" },
    scope: "single_execution",
    reason: "pausing while investigating a related incident",
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

/** Builds a machine + store + identity resolver, and drives a fresh execution to a given state via legal transitions. */
async function buildHarness() {
  const stateStore = new InMemoryExecutionStateStore();
  const eventEmitter = new InMemoryPlatformEventEmitter();
  const evidenceRecorder = new InMemoryEvidenceRecorder();
  const stateMachine = new ExecutionStateMachine({ stateStore, eventEmitter, evidenceRecorder, now: () => NOW });
  const identityResolver = new LocalDevIdentityResolver([
    { id: "user_oncall", tenant_id: TENANT, display_name: "On-call", roles: ["senior_oncall"] },
    { id: "user_engineer", tenant_id: TENANT, display_name: "Engineer", roles: ["engineer"] },
  ]);

  const { execution } = await stateMachine.createExecution({
    tenantId: TENANT,
    requestId: "req_1",
    opcId: "opc_1",
    opcVersion: "1.0.0",
  });

  return { stateStore, eventEmitter, evidenceRecorder, stateMachine, identityResolver, execution };
}

async function driveTo(stateMachine: ExecutionStateMachine, executionId: string, path: ExecutionState["state"][]): Promise<void> {
  for (const toState of path) {
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

describe("haltExecution() — emergency halt / kill switch (D-05, spec §7A)", () => {
  it("CRITICAL: an authorized actor halts an in-flight execution -> ESCALATED_HUMAN_OVERRIDE, with auditable Evidence + execution.halted event", async () => {
    const { stateStore, eventEmitter, evidenceRecorder, stateMachine, identityResolver, execution } = await buildHarness();
    await driveTo(stateMachine, execution.execution_id, ["OPC_MATCHED", "CONTEXT_ASSEMBLY", "INVESTIGATING"]);

    const result = await haltExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      haltRequest: haltRequest(),
      requiredHaltRoles: REQUIRED_HALT_ROLES,
      identityResolver,
      stateMachine,
      stateStore,
    });

    expect(result.outcome).toBe("HALTED");
    if (result.outcome !== "HALTED") return;
    expect(result.execution.state).toBe("ESCALATED_HUMAN_OVERRIDE");

    const persisted = await stateStore.get(TENANT, execution.execution_id);
    expect(persisted?.state).toBe("ESCALATED_HUMAN_OVERRIDE");

    const events = eventEmitter.eventsFor(execution.execution_id);
    expect(events.some((e) => e.event_type === "execution.halted")).toBe(true);

    const evidenceRecords = evidenceRecorder.evidenceFor(execution.execution_id);
    const haltEvidence = evidenceRecords.find((e) => e.content.summary.includes("halted"));
    expect(haltEvidence).toBeDefined();
    expect(haltEvidence?.type).toBe("OUTCOME");
    expect(haltEvidence?.content.structured_data?.halt_request).toEqual(haltRequest());
  });

  it.each([
    ["RECEIVED" as const, [] as ExecutionState["state"][]],
    ["WAITING_APPROVAL" as const, ["OPC_MATCHED", "CONTEXT_ASSEMBLY", "INVESTIGATING", "DIAGNOSED", "PLANNED", "WAITING_APPROVAL"] as ExecutionState["state"][]],
    ["EXECUTING" as const, ["OPC_MATCHED", "CONTEXT_ASSEMBLY", "INVESTIGATING", "DIAGNOSED", "PLANNED", "WAITING_APPROVAL", "EXECUTING"] as ExecutionState["state"][]],
    ["VERIFYING" as const, ["OPC_MATCHED", "CONTEXT_ASSEMBLY", "INVESTIGATING", "DIAGNOSED", "PLANNED", "WAITING_APPROVAL", "EXECUTING", "VERIFYING"] as ExecutionState["state"][]],
  ])("halting is legal from %s — a halt can arrive at any point before an execution's own terminal state", async (_label, path) => {
    const { stateStore, stateMachine, identityResolver, execution } = await buildHarness();
    await driveTo(stateMachine, execution.execution_id, path);

    const result = await haltExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      haltRequest: haltRequest(),
      requiredHaltRoles: REQUIRED_HALT_ROLES,
      identityResolver,
      stateMachine,
      stateStore,
    });

    expect(result.outcome).toBe("HALTED");
  });

  it("CRITICAL: an actor whose real roles don't include any required_halt_role is rejected — the request's self-claimed actor.role is never trusted", async () => {
    const { stateStore, stateMachine, identityResolver, execution } = await buildHarness();

    // user_engineer's REAL role (per IdentityResolver) is "engineer", not
    // senior_oncall — but the request CLAIMS senior_oncall. The claim must
    // not be trusted.
    const result = await haltExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      haltRequest: haltRequest({ actor: { id: "user_engineer", role: "senior_oncall" } }),
      requiredHaltRoles: REQUIRED_HALT_ROLES,
      identityResolver,
      stateMachine,
      stateStore,
    });

    expect(result.outcome).toBe("REJECTED_UNAUTHORIZED_ACTOR");
    const persisted = await stateStore.get(TENANT, execution.execution_id);
    expect(persisted?.state).toBe("RECEIVED");
  });

  it("rejects an unknown actor (not resolvable by IdentityResolver)", async () => {
    const { stateStore, stateMachine, identityResolver, execution } = await buildHarness();
    const result = await haltExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      haltRequest: haltRequest({ actor: { id: "user_never_registered", role: "senior_oncall" } }),
      requiredHaltRoles: REQUIRED_HALT_ROLES,
      identityResolver,
      stateMachine,
      stateStore,
    });
    expect(result.outcome).toBe("REJECTED_UNAUTHORIZED_ACTOR");
  });

  it("rejects halting an execution that doesn't exist", async () => {
    const { stateStore, stateMachine, identityResolver } = await buildHarness();
    const result = await haltExecution({
      tenantId: TENANT,
      executionId: "never_existed",
      haltRequest: haltRequest(),
      requiredHaltRoles: REQUIRED_HALT_ROLES,
      identityResolver,
      stateMachine,
      stateStore,
    });
    expect(result.outcome).toBe("REJECTED_EXECUTION_NOT_FOUND");
  });

  it("halting an already-halted execution is an idempotent no-op — ALREADY_HALTED, not an error", async () => {
    const { stateStore, stateMachine, identityResolver, execution } = await buildHarness();
    const first = await haltExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      haltRequest: haltRequest(),
      requiredHaltRoles: REQUIRED_HALT_ROLES,
      identityResolver,
      stateMachine,
      stateStore,
    });
    expect(first.outcome).toBe("HALTED");

    const second = await haltExecution({
      tenantId: TENANT,
      executionId: execution.execution_id,
      haltRequest: haltRequest({ reason: "a second, redundant halt request" }),
      requiredHaltRoles: REQUIRED_HALT_ROLES,
      identityResolver,
      stateMachine,
      stateStore,
    });
    expect(second.outcome).toBe("ALREADY_HALTED");
    if (second.outcome !== "ALREADY_HALTED") return;
    expect(second.execution.state).toBe("ESCALATED_HUMAN_OVERRIDE");
  });

  it.each([
    ["RESOLVED", ["OPC_MATCHED", "CONTEXT_ASSEMBLY", "INVESTIGATING", "DIAGNOSED", "PLANNED", "WAITING_APPROVAL", "EXECUTING", "VERIFYING", "RESOLVED"]],
    ["ESCALATED", ["OPC_MATCHED", "ESCALATED"]],
    ["FAILED", ["FAILED"]],
  ] as const)(
    "CRITICAL: throws when trying to halt an execution already in the terminal state %s — halting an already-completed action never applies",
    async (terminalState, path) => {
      const { stateStore, stateMachine, identityResolver, execution } = await buildHarness();
      await driveTo(stateMachine, execution.execution_id, [...path]);

      await expect(
        haltExecution({
          tenantId: TENANT,
          executionId: execution.execution_id,
          haltRequest: haltRequest(),
          requiredHaltRoles: REQUIRED_HALT_ROLES,
          identityResolver,
          stateMachine,
          stateStore,
        }),
      ).rejects.toThrow(/already in terminal state/);
    },
  );

  it("rejects scope: all_tenant_executions — not yet supported, disclosed explicitly rather than silently no-op'd", async () => {
    const { stateStore, stateMachine, identityResolver, execution } = await buildHarness();
    await expect(
      haltExecution({
        tenantId: TENANT,
        executionId: execution.execution_id,
        haltRequest: haltRequest({ scope: "all_tenant_executions" }),
        requiredHaltRoles: REQUIRED_HALT_ROLES,
        identityResolver,
        stateMachine,
        stateStore,
      }),
    ).rejects.toThrow(/all_tenant_executions/);
  });
});
