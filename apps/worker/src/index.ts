/**
 * @aop/worker — durable orchestrator (spec §7). Consumes triggers, drives
 * ExecutionState transitions, invokes Investigator/Planner agents,
 * enforces budget, recovers crashed executions. The state machine
 * skeleton (B-03), the Investigator (B-05) and Planner (B-06) agents, the
 * emergency halt / kill switch (D-05), budget governance (D-06), and the
 * crash-recovery marker + status-check flow (D-07) exist so far — job
 * consumption (BullMQ) lands with the story that needs it.
 */
export * from "./orchestrator/state-machine.js";
export * from "./orchestrator/execution-state-store.js";
export * from "./orchestrator/platform-event-emitter.js";
export * from "./orchestrator/evidence-recorder.js";
export * from "./orchestrator/emergency-halt.js";
export * from "./orchestrator/budget-governance.js";
export * from "./orchestrator/crash-recovery.js";
export * from "./agents/investigator.js";
export * from "./agents/planner.js";
export * from "./agents/simulated-llm-provider.js";
