/**
 * @aop/action-executor — ActionConnector interface + registry (§13-14),
 * preflight/drift check (§14B), execution identity delegation (§14A),
 * rollback (§20), crash-recovery marker + status check (§7.2, ADR-004).
 * The Frozen Plan Rule guard (B-06), the versioned Action Registry's
 * mechanics (C-02) with compensation-class validation at registration
 * (D-04), the ActionConnector interface + simulated implementation
 * (D-01), the structural preflight-then-execute gate (D-02), the
 * three-class rollback decision gate (D-04), and the deterministic
 * operation_id + ExecutionStepMarkerStore (D-07) exist so far.
 */
export * from "./frozen-plan-guard.js";
export * from "./action-registry.js";
export * from "./action-connector.js";
export * from "./simulated-action-connector.js";
export * from "./gated-execution.js";
export * from "./rollback-decision.js";
export * from "./operation-id.js";
export * from "./execution-step-marker-store.js";
