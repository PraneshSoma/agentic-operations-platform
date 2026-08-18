import { describe, expect, it } from "vitest";
import type { ExecutionState, OperationalProcedureContract } from "@aop/contracts";
import { ExecutionStateMachine } from "./state-machine.js";
import { InMemoryExecutionStateStore } from "./execution-state-store.js";
import { InMemoryPlatformEventEmitter } from "./platform-event-emitter.js";
import { InMemoryEvidenceRecorder } from "./evidence-recorder.js";
import { checkBudget, enforceBudget } from "./budget-governance.js";

const CREATED_AT = new Date("2026-08-18T12:00:00.000Z");

function budget(overrides: Partial<OperationalProcedureContract["budget"]> = {}): OperationalProcedureContract["budget"] {
  return {
    max_investigation_tokens: 10_000,
    max_planning_tokens: 5_000,
    max_tool_calls: 10,
    max_wall_clock_minutes: 30,
    on_exceeded: "ESCALATE",
    ...overrides,
  };
}

function execution(overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    execution_id: "exec_1",
    tenant_id: "tenant_1",
    request_id: "req_1",
    opc_id: "opc_1",
    opc_version: "1.0.0",
    state: "INVESTIGATING",
    proposal_ids: [],
    retry_count: 0,
    budget_consumed: { investigation_tokens: 100, planning_tokens: 0, tool_calls: 0 },
    created_at: CREATED_AT.toISOString(),
    updated_at: CREATED_AT.toISOString(),
    ...overrides,
  };
}

describe("checkBudget() — pure comparison against OPC-declared ceilings", () => {
  it("WITHIN_BUDGET when every dimension is under its ceiling", () => {
    const result = checkBudget(execution(), budget(), CREATED_AT);
    expect(result.status).toBe("WITHIN_BUDGET");
  });

  it("consuming exactly the ceiling is still within budget", () => {
    const result = checkBudget(
      execution({ budget_consumed: { investigation_tokens: 10_000, planning_tokens: 5_000, tool_calls: 10 } }),
      budget(),
      CREATED_AT,
    );
    expect(result.status).toBe("WITHIN_BUDGET");
  });

  it("EXCEEDED on investigation_tokens one unit past the ceiling", () => {
    const result = checkBudget(
      execution({ budget_consumed: { investigation_tokens: 10_001, planning_tokens: 0, tool_calls: 0 } }),
      budget(),
      CREATED_AT,
    );
    expect(result.status).toBe("EXCEEDED");
    if (result.status !== "EXCEEDED") return;
    expect(result.exceededDimensions).toEqual(["investigation_tokens"]);
  });

  it("EXCEEDED on planning_tokens", () => {
    const result = checkBudget(
      execution({ budget_consumed: { investigation_tokens: 0, planning_tokens: 5_001, tool_calls: 0 } }),
      budget(),
      CREATED_AT,
    );
    expect(result.status).toBe("EXCEEDED");
    if (result.status !== "EXCEEDED") return;
    expect(result.exceededDimensions).toEqual(["planning_tokens"]);
  });

  it("EXCEEDED on tool_calls", () => {
    const result = checkBudget(
      execution({ budget_consumed: { investigation_tokens: 0, planning_tokens: 0, tool_calls: 11 } }),
      budget(),
      CREATED_AT,
    );
    expect(result.status).toBe("EXCEEDED");
    if (result.status !== "EXCEEDED") return;
    expect(result.exceededDimensions).toEqual(["tool_calls"]);
  });

  it("EXCEEDED on wall_clock_minutes", () => {
    const now = new Date(CREATED_AT.getTime() + 31 * 60_000);
    const result = checkBudget(execution(), budget(), now);
    expect(result.status).toBe("EXCEEDED");
    if (result.status !== "EXCEEDED") return;
    expect(result.exceededDimensions).toEqual(["wall_clock_minutes"]);
  });

  it("reports every exceeded dimension at once when multiple ceilings are breached", () => {
    const result = checkBudget(
      execution({ budget_consumed: { investigation_tokens: 10_001, planning_tokens: 5_001, tool_calls: 11 } }),
      budget(),
      CREATED_AT,
    );
    expect(result.status).toBe("EXCEEDED");
    if (result.status !== "EXCEEDED") return;
    expect(result.exceededDimensions).toEqual(["investigation_tokens", "planning_tokens", "tool_calls"]);
  });
});

describe("enforceBudget() — enforcement + Evidence Ledger recording (D-06, F-12)", () => {
  function buildHarness() {
    const stateStore = new InMemoryExecutionStateStore();
    const eventEmitter = new InMemoryPlatformEventEmitter();
    const evidenceRecorder = new InMemoryEvidenceRecorder();
    const stateMachine = new ExecutionStateMachine({ stateStore, eventEmitter, evidenceRecorder, now: () => CREATED_AT });
    return { stateStore, eventEmitter, evidenceRecorder, stateMachine };
  }

  it("WITHIN_BUDGET: no state transition, but a standalone Evidence record is still written", async () => {
    const { stateStore, stateMachine, evidenceRecorder } = buildHarness();
    await stateStore.save(execution());

    const result = await enforceBudget({
      tenantId: "tenant_1",
      executionId: "exec_1",
      budget: budget(),
      stateMachine,
      stateStore,
      evidenceRecorder,
      now: () => CREATED_AT,
    });

    expect(result.outcome).toBe("WITHIN_BUDGET");
    const persisted = await stateStore.get("tenant_1", "exec_1");
    expect(persisted?.state).toBe("INVESTIGATING"); // unchanged

    const evidenceRecords = evidenceRecorder.evidenceFor("exec_1");
    expect(evidenceRecords).toHaveLength(1);
    expect(evidenceRecords[0]?.content.summary).toContain("within budget");
  });

  it("CRITICAL: EXCEEDED + default ESCALATE -> transitions to ESCALATED with escalation_reason BUDGET_EXCEEDED, never silently truncates", async () => {
    const { stateStore, stateMachine, evidenceRecorder } = buildHarness();
    await stateStore.save(execution({ budget_consumed: { investigation_tokens: 10_001, planning_tokens: 0, tool_calls: 0 } }));

    const result = await enforceBudget({
      tenantId: "tenant_1",
      executionId: "exec_1",
      budget: budget(),
      stateMachine,
      stateStore,
      evidenceRecorder,
      now: () => CREATED_AT,
    });

    expect(result.outcome).toBe("ESCALATED");
    if (result.outcome !== "ESCALATED") return;
    expect(result.execution.state).toBe("ESCALATED");
    expect(result.exceededDimensions).toEqual(["investigation_tokens"]);

    const persisted = await stateStore.get("tenant_1", "exec_1");
    expect(persisted?.state).toBe("ESCALATED");

    const evidenceRecords = evidenceRecorder.evidenceFor("exec_1");
    const escalationEvidence = evidenceRecords.find((e) => e.content.summary.includes("BUDGET_EXCEEDED"));
    expect(escalationEvidence).toBeDefined();
    expect(escalationEvidence?.content.structured_data?.escalation_reason).toBe("BUDGET_EXCEEDED");
  });

  it("CRITICAL: EXCEEDED + STOP_AND_SUMMARIZE -> REQUIRES_SUMMARIZATION, never a silent no-op, no state transition", async () => {
    const { stateStore, stateMachine, evidenceRecorder } = buildHarness();
    await stateStore.save(execution({ budget_consumed: { investigation_tokens: 10_001, planning_tokens: 0, tool_calls: 0 } }));

    const result = await enforceBudget({
      tenantId: "tenant_1",
      executionId: "exec_1",
      budget: budget({ on_exceeded: "STOP_AND_SUMMARIZE" }),
      stateMachine,
      stateStore,
      evidenceRecorder,
      now: () => CREATED_AT,
    });

    expect(result.outcome).toBe("REQUIRES_SUMMARIZATION");
    if (result.outcome !== "REQUIRES_SUMMARIZATION") return;
    expect(result.exceededDimensions).toEqual(["investigation_tokens"]);

    // No state transition occurred — STOP_AND_SUMMARIZE never silently
    // resolves or escalates on its own; the caller must explicitly act.
    const persisted = await stateStore.get("tenant_1", "exec_1");
    expect(persisted?.state).toBe("INVESTIGATING");

    const evidenceRecords = evidenceRecorder.evidenceFor("exec_1");
    expect(evidenceRecords.some((e) => e.content.summary.includes("exceeded"))).toBe(true);
  });

  it.each(["CONTEXT_ASSEMBLY", "PLANNED", "EXECUTING"] as const)(
    "escalates on budget overage from state %s — the graph extension this story adds",
    async (state) => {
      const { stateStore, stateMachine, evidenceRecorder } = buildHarness();
      await stateStore.save(execution({ state, budget_consumed: { investigation_tokens: 0, planning_tokens: 0, tool_calls: 11 } }));

      const result = await enforceBudget({
        tenantId: "tenant_1",
        executionId: "exec_1",
        budget: budget(),
        stateMachine,
        stateStore,
        evidenceRecorder,
        now: () => CREATED_AT,
      });

      expect(result.outcome).toBe("ESCALATED");
    },
  );

  it("throws when the execution doesn't exist", async () => {
    const { stateStore, stateMachine, evidenceRecorder } = buildHarness();
    await expect(
      enforceBudget({
        tenantId: "tenant_1",
        executionId: "never_existed",
        budget: budget(),
        stateMachine,
        stateStore,
        evidenceRecorder,
        now: () => CREATED_AT,
      }),
    ).rejects.toThrow(/No execution/);
  });

  it("defaults `now` to the real wall clock when not injected", async () => {
    const { stateStore, stateMachine, evidenceRecorder } = buildHarness();
    await stateStore.save(execution({ created_at: new Date().toISOString() }));

    const result = await enforceBudget({
      tenantId: "tenant_1",
      executionId: "exec_1",
      budget: budget(),
      stateMachine,
      stateStore,
      evidenceRecorder,
    });

    expect(result.outcome).toBe("WITHIN_BUDGET");
  });
});
