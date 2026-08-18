import { VerificationResultSchema, type ExecutionResult, type VerificationCheckName } from "@aop/contracts";

/**
 * Verification Engine (spec §19, F-13) — "execution success does not equal
 * resolution success." Verification is mandatory for mutating operations.
 *
 * Scope decision: this engine receives already-evaluated per-check results
 * (name/status/evidence_ids) rather than executing an OPC's
 * `verification.checks[].success_condition` itself. That field is an
 * unconstrained string (spec §4.2's OPC contract), and spec §4.2 explicitly
 * forbids an OPC containing executable arbitrary code — evaluating a
 * tenant-authored condition string as an expression would mean running
 * tenant data as code. Actually gathering each check's evidence and
 * deciding PASS/FAIL/UNKNOWN is the caller's job (a connector read,
 * analogous to preflight's PreconditionSet checks); this engine owns the
 * one thing spec §19/§20/§30 actually mandate as policy, not per-check
 * mechanics: aggregating checks into an overall verdict and deriving the
 * one recommended_next_step that verdict allows.
 *
 * Decision policy (spec §20 Rollback Manager, §30 Failure Handling):
 *   - No checks at all -> INCONCLUSIVE. A verification with nothing to
 *     verify is never treated as an implicit pass (same "never an implicit
 *     pass" discipline as D-01/D-02's preflight UNKNOWN handling).
 *   - Any check FAILED -> overall FAILED.
 *   - Else any check UNKNOWN -> overall INCONCLUSIVE.
 *   - Else (every check PASS) -> overall VERIFIED.
 *
 *   - VERIFIED -> CLOSE.
 *   - INCONCLUSIVE -> ESCALATE, unconditionally (spec §30: "Verification
 *     inconclusive -> ESCALATE. Do not mark ticket resolved." — never
 *     ROLLBACK, since an inconclusive result gives no basis to believe a
 *     rollback is even warranted).
 *   - FAILED -> ROLLBACK if the action's compensation_class is REVERSIBLE
 *     or COMPENSATABLE; ESCALATE if IRREVERSIBLE (spec §20's "Is action
 *     reversible?" branch, refined by F-14's three-way compensation_class
 *     split — an IRREVERSIBLE action has no rollback path to offer at all).
 */
export interface VerificationCheckInput {
  name: VerificationCheckName;
  status: "PASS" | "FAIL" | "UNKNOWN";
  evidence_ids: string[];
}

export interface VerificationInput {
  verificationId: string;
  executionResult: ExecutionResult;
  checks: VerificationCheckInput[];
  compensationClass: "REVERSIBLE" | "COMPENSATABLE" | "IRREVERSIBLE";
}

function computeOverall(checks: VerificationCheckInput[]): "VERIFIED" | "FAILED" | "INCONCLUSIVE" {
  if (checks.length === 0) return "INCONCLUSIVE";
  if (checks.some((check) => check.status === "FAIL")) return "FAILED";
  if (checks.some((check) => check.status === "UNKNOWN")) return "INCONCLUSIVE";
  return "VERIFIED";
}

function recommendNextStep(
  overall: "VERIFIED" | "FAILED" | "INCONCLUSIVE",
  compensationClass: "REVERSIBLE" | "COMPENSATABLE" | "IRREVERSIBLE",
): "CLOSE" | "ROLLBACK" | "ESCALATE" {
  if (overall === "VERIFIED") return "CLOSE";
  if (overall === "INCONCLUSIVE") return "ESCALATE";
  // overall === "FAILED"
  return compensationClass === "REVERSIBLE" || compensationClass === "COMPENSATABLE" ? "ROLLBACK" : "ESCALATE";
}

export function runVerification(input: VerificationInput) {
  const overall = computeOverall(input.checks);
  const recommended_next_step = recommendNextStep(overall, input.compensationClass);

  return VerificationResultSchema.parse({
    verification_id: input.verificationId,
    execution_result_id: input.executionResult.execution_result_id,
    checks: input.checks,
    overall,
    recommended_next_step,
  });
}
