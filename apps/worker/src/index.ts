/**
 * @aop/worker — durable orchestrator (spec §7). Consumes triggers, drives
 * ExecutionState transitions, invokes Investigator/Planner agents,
 * enforces budget. Only the state machine skeleton exists so far (story
 * B-03) — job consumption (BullMQ) and the agent invocations it drives
 * land with the stories that need them (B-04 through D-07).
 */
export * from "./orchestrator/state-machine.js";
export * from "./orchestrator/execution-state-store.js";
export * from "./orchestrator/platform-event-emitter.js";
export * from "./orchestrator/evidence-recorder.js";
