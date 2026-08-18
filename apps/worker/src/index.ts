/**
 * @aop/worker — durable orchestrator (spec §7). Consumes triggers, drives
 * ExecutionState transitions, invokes Investigator/Planner agents,
 * enforces budget. The state machine skeleton (B-03), the Investigator
 * agent (B-05), and the emergency halt / kill switch (D-05) exist so far
 * — the Planner (B-06) already lands too; job consumption (BullMQ) and
 * budget enforcement (D-06) land with the stories that need them.
 */
export * from "./orchestrator/state-machine.js";
export * from "./orchestrator/execution-state-store.js";
export * from "./orchestrator/platform-event-emitter.js";
export * from "./orchestrator/evidence-recorder.js";
export * from "./orchestrator/emergency-halt.js";
export * from "./agents/investigator.js";
export * from "./agents/planner.js";
export * from "./agents/simulated-llm-provider.js";
