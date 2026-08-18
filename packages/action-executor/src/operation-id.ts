import { createHash } from "node:crypto";

/**
 * Deterministic operation_id derivation (LLD-v1 §2, story D-07):
 * "deterministically derived (hash of those three + action_version), NOT
 * regenerated per attempt. Reused across retries so the connector can
 * recognize repeat attempts of the same logical operation — this is what
 * makes it a real idempotency key, not just a log entry."
 *
 * Calling this twice with the same inputs must return the exact same
 * string — that's the entire point (same discipline as C-03's
 * `evaluatePolicy()` determinism-by-construction: provable by calling it
 * twice and comparing output, not just asserted in a comment).
 */
export function deriveOperationId(tenantId: string, executionId: string, stepId: string, actionVersion: string): string {
  const hash = createHash("sha256").update(`${tenantId}::${executionId}::${stepId}::${actionVersion}`).digest("hex");
  return `op_${hash}`;
}
