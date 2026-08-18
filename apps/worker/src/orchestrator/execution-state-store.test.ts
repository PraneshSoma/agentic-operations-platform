import { describe, expect, it } from "vitest";
import type { ExecutionState } from "@aop/contracts";
import { InMemoryExecutionStateStore } from "./execution-state-store.js";

function execution(overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    execution_id: "exec_1",
    tenant_id: "tenant_1",
    request_id: "req_1",
    opc_id: "opc_1",
    opc_version: "1.0.0",
    state: "RECEIVED",
    proposal_ids: [],
    retry_count: 0,
    budget_consumed: { investigation_tokens: 0, planning_tokens: 0, tool_calls: 0 },
    created_at: "2026-08-18T00:00:00.000Z",
    updated_at: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("InMemoryExecutionStateStore", () => {
  it("saves and retrieves by (tenant_id, execution_id)", async () => {
    const store = new InMemoryExecutionStateStore();
    await store.save(execution());
    expect(await store.get("tenant_1", "exec_1")).toEqual(execution());
  });

  it("returns undefined for a wrong tenant_id — no cross-tenant read (RULE 4)", async () => {
    const store = new InMemoryExecutionStateStore();
    await store.save(execution());
    expect(await store.get("tenant_2", "exec_1")).toBeUndefined();
  });

  it("finds by (tenant_id, request_id) — the idempotency lookup (spec §31)", async () => {
    const store = new InMemoryExecutionStateStore();
    await store.save(execution());
    expect(await store.findByRequestId("tenant_1", "req_1")).toEqual(execution());
  });

  it("findByRequestId returns undefined when no execution exists for that request yet", async () => {
    const store = new InMemoryExecutionStateStore();
    expect(await store.findByRequestId("tenant_1", "req_never_seen")).toBeUndefined();
  });

  it("save() upserts — a second save with the same execution_id overwrites, not duplicates", async () => {
    const store = new InMemoryExecutionStateStore();
    await store.save(execution());
    await store.save(execution({ state: "OPC_MATCHED" }));
    expect((await store.get("tenant_1", "exec_1"))?.state).toBe("OPC_MATCHED");
  });
});
