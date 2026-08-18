/**
 * @aop/action-executor — ActionConnector interface + registry (§13-14),
 * preflight/drift check (§14B), execution identity delegation (§14A),
 * rollback (§20). Only the Frozen Plan Rule guard exists so far (story
 * B-06) — the ActionConnector interface and simulated implementation land
 * in D-01.
 */
export * from "./frozen-plan-guard.js";
