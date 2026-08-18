/**
 * @aop/policy-engine — deterministic PolicyRule evaluation (§15-16), risk
 * classification, OPC-match margin guardrail (§6A). Only OPC matching
 * (story B-02) exists so far; PolicyRule evaluation lands in C-03.
 */
export * from "./matching/opc-matcher.js";
export * from "./matching/semantic-matcher.js";
export * from "./matching/opc-match-evidence-sink.js";
