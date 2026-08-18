import { describe, expect, it } from "vitest";
import type { ExecutionStepMarker } from "@aop/contracts";
import { InMemoryExecutionStepMarkerStore } from "./execution-step-marker-store.js";

function marker(overrides: Partial<ExecutionStepMarker> = {}): ExecutionStepMarker {
  return {
    marker_id: "marker_1",
    tenant_id: "tenant_1",
    execution_id: "exec_1",
    step_id: "step_1",
    operation_id: "op_abc",
    action_ref: "restart_service",
    action_version: "1.0.0",
    connector_ref: "sim-action-connector",
    connector_version: "1.0.0",
    attempt_number: 1,
    status: "ATTEMPTED",
    created_at: "2026-08-18T12:00:00.000Z",
    updated_at: "2026-08-18T12:00:00.000Z",
    ...overrides,
  };
}

describe("InMemoryExecutionStepMarkerStore", () => {
  it("returns undefined for a marker that was never saved", async () => {
    const store = new InMemoryExecutionStepMarkerStore();
    expect(await store.get("tenant_1", "exec_1", "step_1")).toBeUndefined();
  });

  it("saves and retrieves a marker by (tenant_id, execution_id, step_id)", async () => {
    const store = new InMemoryExecutionStepMarkerStore();
    await store.save(marker());
    expect(await store.get("tenant_1", "exec_1", "step_1")).toEqual(marker());
  });

  it("save() upserts — a second save for the same key overwrites the first", async () => {
    const store = new InMemoryExecutionStepMarkerStore();
    await store.save(marker({ attempt_number: 1, status: "ATTEMPTED" }));
    await store.save(marker({ attempt_number: 2, status: "COMPLETED" }));
    const result = await store.get("tenant_1", "exec_1", "step_1");
    expect(result?.attempt_number).toBe(2);
    expect(result?.status).toBe("COMPLETED");
  });

  it("markers for different steps within the same execution coexist independently", async () => {
    const store = new InMemoryExecutionStepMarkerStore();
    await store.save(marker({ step_id: "step_1" }));
    await store.save(marker({ step_id: "step_2", marker_id: "marker_2" }));
    expect((await store.get("tenant_1", "exec_1", "step_1"))?.marker_id).toBe("marker_1");
    expect((await store.get("tenant_1", "exec_1", "step_2"))?.marker_id).toBe("marker_2");
  });

  it("markers for the same step under different tenants coexist independently (RULE 4)", async () => {
    const store = new InMemoryExecutionStepMarkerStore();
    await store.save(marker({ tenant_id: "tenant_1" }));
    await store.save(marker({ tenant_id: "tenant_2", marker_id: "marker_2" }));
    expect((await store.get("tenant_1", "exec_1", "step_1"))?.marker_id).toBe("marker_1");
    expect((await store.get("tenant_2", "exec_1", "step_1"))?.marker_id).toBe("marker_2");
  });
});
