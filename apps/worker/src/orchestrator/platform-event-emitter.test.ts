import { describe, expect, it } from "vitest";
import type { PlatformEvent } from "@aop/contracts";
import { InMemoryPlatformEventEmitter } from "./platform-event-emitter.js";

const event: PlatformEvent = {
  event_id: "evt_1",
  event_type: "execution.started",
  tenant_id: "tenant_1",
  request_id: "req_1",
  execution_id: "exec_1",
  occurred_at: "2026-08-18T00:00:00.000Z",
  payload_ref: "ref_1",
  correlation_id: "req_1",
};

describe("InMemoryPlatformEventEmitter", () => {
  it("emits and returns events via eventsFor()", async () => {
    const emitter = new InMemoryPlatformEventEmitter();
    await emitter.emit(event);
    expect(emitter.eventsFor("exec_1")).toEqual([event]);
  });

  it("returns an empty array for an execution with no emitted events", () => {
    const emitter = new InMemoryPlatformEventEmitter();
    expect(emitter.eventsFor("exec_never_used")).toEqual([]);
  });

  it("accumulates multiple events for the same execution in order", async () => {
    const emitter = new InMemoryPlatformEventEmitter();
    const second: PlatformEvent = { ...event, event_id: "evt_2", event_type: "execution.completed" };
    await emitter.emit(event);
    await emitter.emit(second);
    expect(emitter.eventsFor("exec_1")).toEqual([event, second]);
  });
});
