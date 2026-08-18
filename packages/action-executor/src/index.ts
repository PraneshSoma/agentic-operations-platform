/**
 * @aop/action-executor — ActionConnector interface + registry (§13-14),
 * preflight/drift check (§14B), execution identity delegation (§14A),
 * rollback (§20). The Frozen Plan Rule guard (B-06) and the versioned
 * Action Registry's mechanics (C-02) exist so far — the ActionConnector
 * interface and simulated implementation land in D-01.
 */
export * from "./frozen-plan-guard.js";
export * from "./action-registry.js";
