/**
 * @aop/contracts — shared domain contracts for the Agentic Operations Platform.
 *
 * One Zod schema + inferred TS type per domain contract, re-exported here.
 * No logic beyond schema + type + narrow helper validators — every other
 * package imports from this one; this one imports from none.
 */
export * from "./schemas/incoming-request.js";
export * from "./schemas/operational-procedure-contract.js";
export * from "./schemas/proposed-action.js";
export * from "./schemas/policy-decision.js";
export * from "./schemas/execution-result.js";
export * from "./schemas/evidence.js";

/**
 * Retained from the pre-Build scaffold — proved the workspace toolchain
 * (build/lint/test) before any real contract existed. Harmless to keep; a
 * future story may retire it once nothing references it as a signal.
 */
export const CONTRACTS_PACKAGE_SCAFFOLD = true;
