import { describe, expect, it } from "vitest";
import type { PlatformEvent } from "@aop/contracts";
import { DEFAULT_EVENT_SCHEMA_VERSION, buildOutboxEvent } from "./outbox-event.js";

function platformEvent(overrides: Partial<PlatformEvent> = {}): PlatformEvent {
  return {
    event_id: "evt_1",
    event_type: "execution.started",
    tenant_id: "tenant_1",
    request_id: "req_1",
    execution_id: "exec_1",
    occurred_at: "2026-08-18T12:00:00.000Z",
    payload_ref: "state:exec_1:EXECUTING",
    correlation_id: "req_1",
    ...overrides,
  };
}

describe("buildOutboxEvent() — outbox row from a PlatformEvent (E-02, ADR-005)", () => {
  it("carries event_id, tenant_id, execution_id, event_type through from the PlatformEvent", () => {
    const row = buildOutboxEvent(platformEvent(), { aggregate_type: "execution", aggregate_id: "exec_1", aggregate_version: 3 });
    expect(row.event_id).toBe("evt_1");
    expect(row.tenant_id).toBe("tenant_1");
    expect(row.execution_id).toBe("exec_1");
    expect(row.event_type).toBe("execution.started");
  });

  it("sets aggregate fields from options", () => {
    const row = buildOutboxEvent(platformEvent(), { aggregate_type: "execution", aggregate_id: "exec_1", aggregate_version: 7 });
    expect(row.aggregate_type).toBe("execution");
    expect(row.aggregate_id).toBe("exec_1");
    expect(row.aggregate_version).toBe(7);
  });

  it("carries the full PlatformEvent as the payload so a relayed consumer gets the whole event", () => {
    const event = platformEvent();
    const row = buildOutboxEvent(event, { aggregate_type: "execution", aggregate_id: "exec_1", aggregate_version: 1 });
    expect(row.payload).toEqual({ ...event });
  });

  it("defaults event_schema_version and available_at (to occurred_at) when not given", () => {
    const row = buildOutboxEvent(platformEvent(), { aggregate_type: "execution", aggregate_id: "exec_1", aggregate_version: 1 });
    expect(row.event_schema_version).toBe(DEFAULT_EVENT_SCHEMA_VERSION);
    expect(row.available_at).toBe("2026-08-18T12:00:00.000Z");
  });

  it("honors explicit event_schema_version and available_at (delayed emission)", () => {
    const row = buildOutboxEvent(platformEvent(), {
      aggregate_type: "execution",
      aggregate_id: "exec_1",
      aggregate_version: 1,
      event_schema_version: "2.0.0",
      available_at: "2026-08-18T12:05:00.000Z",
    });
    expect(row.event_schema_version).toBe("2.0.0");
    expect(row.available_at).toBe("2026-08-18T12:05:00.000Z");
  });
});
