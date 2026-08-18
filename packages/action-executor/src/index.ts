/**
 * @aop/action-executor — ActionConnector interface + registry (§13-14),
 * preflight/drift check (§14B), execution identity delegation (§14A),
 * rollback (§20). The Frozen Plan Rule guard (B-06), the versioned
 * Action Registry's mechanics (C-02), the ActionConnector interface +
 * simulated implementation (D-01), and the structural preflight-then-
 * execute gate (D-02) exist so far.
 */
export * from "./frozen-plan-guard.js";
export * from "./action-registry.js";
export * from "./action-connector.js";
export * from "./simulated-action-connector.js";
export * from "./gated-execution.js";
