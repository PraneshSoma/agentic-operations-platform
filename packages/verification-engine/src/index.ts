/**
 * @aop/verification-engine — Verification Engine (spec §19, F-13): the
 * mandatory post-execution decision policy. "Execution success does not
 * equal resolution success" — FAILED/INCONCLUSIVE never marks a ticket
 * resolved, recommended_next_step is always populated, and ROLLBACK is
 * only ever offered for REVERSIBLE/COMPENSATABLE actions.
 */
export * from "./run-verification.js";
