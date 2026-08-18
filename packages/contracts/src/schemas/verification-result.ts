import { z } from "zod";

// spec §19: Execution success does not equal resolution success. Verification
// is mandatory for mutating operations.
//
// LLD-v1 §2 "Enums newly formalized": VerificationResult.checks[].name is
// constrained to a formal enum (ADR-006), replacing the spec's unconstrained
// `string` — an unbounded check name would make VERIFIED/FAILED/INCONCLUSIVE
// outcomes impossible to audit or aggregate across executions.
export const VerificationCheckNameSchema = z.enum([
  "UNIT_TEST",
  "INTEGRATION_TEST",
  "STATIC_ANALYSIS",
  "POLICY_CHECK",
  "ROLE_SEPARATED_REVIEW",
  "PRODUCTION_EVIDENCE",
  "PREFLIGHT_DRIFT_CHECK",
]);
export type VerificationCheckName = z.infer<typeof VerificationCheckNameSchema>;

const VerificationCheckSchema = z.object({
  name: VerificationCheckNameSchema,
  status: z.enum(["PASS", "FAIL", "UNKNOWN"]),
  evidence_ids: z.array(z.string()),
});

export const VerificationResultSchema = z.object({
  verification_id: z.string(),
  execution_result_id: z.string(),
  checks: z.array(VerificationCheckSchema),
  overall: z.enum(["VERIFIED", "FAILED", "INCONCLUSIVE"]),
  recommended_next_step: z.enum(["CLOSE", "ROLLBACK", "ESCALATE"]),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
