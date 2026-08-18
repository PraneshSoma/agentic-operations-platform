/**
 * @aop/policy-engine — deterministic PolicyRule evaluation (§15-16), risk
 * classification, OPC-match margin guardrail (§6A). OPC matching (B-02),
 * the two-phase policy evaluator + fixed hard-deny checks (C-03), and the
 * Approval Acceptance Gate (C-04) exist so far.
 */
export * from "./matching/opc-matcher.js";
export * from "./matching/semantic-matcher.js";
export * from "./matching/opc-match-evidence-sink.js";
export * from "./hard-deny.js";
export * from "./rule-matching.js";
export * from "./evaluate-policy.js";
export * from "./approval-acceptance-gate.js";
