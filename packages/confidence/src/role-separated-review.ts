import { z } from "zod";
import type { ResolutionPlan, VerificationCheckName } from "@aop/contracts";

/**
 * Role-separated review (ADR-006, F-17, story E-04) — a distinct review
 * pass feeding the Verification surface, NOT a second run over the same
 * reasoning.
 *
 * TERMINOLOGY (ADR-006, enforced): this is "role-separated review," never
 * "independent review." Two passes from the same model family are
 * correlated by construction; calling it "independent" overstates the
 * signal. The user-facing label is exported below as the single source a
 * UI pulls from, and a test asserts it never contains "independent".
 *
 * CONTEXT ISOLATION (ADR-006, the whole point): the reviewer receives
 * ONLY the frozen plan, the change it will make ("diff"), the test/check
 * results, and the evidence already gathered — EXPLICITLY NOT the
 * generator's reasoning transcript or chain-of-thought. That exclusion is
 * what makes this a genuinely separate judgment rather than a re-read of
 * the same explanation. It's enforced structurally: this input type has
 * no field capable of carrying a transcript, so the reviewer can't be
 * handed one even by mistake.
 */
export const ROLE_SEPARATED_REVIEW_CHECK_NAME: VerificationCheckName = "ROLE_SEPARATED_REVIEW";
export const ROLE_SEPARATED_REVIEW_LABEL = "Role-separated review";

/** A single reviewable test/check result the reviewer is shown (its own prior verification checks, preflight, etc.). */
const ReviewableCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["PASS", "FAIL", "UNKNOWN"]),
});

/**
 * Exactly what the role-separated reviewer sees — and nothing else. There
 * is deliberately NO `reasoning_transcript` / `chain_of_thought` /
 * `diagnosis_reasoning` field (ADR-006's context isolation). A runtime
 * key-scan test asserts this set never grows to include one.
 */
export const RoleSeparatedReviewInputSchema = z.object({
  frozen_plan: z.custom<ResolutionPlan>(),
  // The change the plan will make — the "diff" for an ops action.
  proposed_change: z.object({
    action_ref: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  }),
  test_results: z.array(ReviewableCheckSchema),
  evidence_ids: z.array(z.string()),
});

export type RoleSeparatedReviewInput = z.infer<typeof RoleSeparatedReviewInputSchema>;

export interface RoleSeparatedReviewVerdict {
  status: "PASS" | "FAIL" | "UNKNOWN";
  rationale: string;
}

/** The pluggable reviewer — runs review.md's discipline as a distinct pass. Real deployments register their own; tests use the simulated one. */
export interface RoleSeparatedReviewer {
  review(input: RoleSeparatedReviewInput): Promise<RoleSeparatedReviewVerdict>;
}

export interface RoleSeparatedReviewResult {
  check: { name: VerificationCheckName; status: "PASS" | "FAIL" | "UNKNOWN"; evidence_ids: string[] };
  rationale: string;
}

/**
 * Runs the role-separated review and packages its verdict as a
 * VerificationResult check (name ROLE_SEPARATED_REVIEW, the formal enum
 * value ADR-006 required — never a free-text label). The reviewer is
 * handed only `input`, which by its type cannot contain the generator's
 * reasoning transcript.
 */
export async function runRoleSeparatedReview(
  input: RoleSeparatedReviewInput,
  reviewer: RoleSeparatedReviewer,
): Promise<RoleSeparatedReviewResult> {
  const verdict = await reviewer.review(input);
  return {
    check: { name: ROLE_SEPARATED_REVIEW_CHECK_NAME, status: verdict.status, evidence_ids: input.evidence_ids },
    rationale: verdict.rationale,
  };
}

/**
 * A deterministic simulated reviewer for the MVP (no second real model
 * call — that's ADR-006's Extension point, "genuine model diversity").
 * Its rule is transparent and testable: FAIL if any shown test failed,
 * UNKNOWN if none failed but some are unknown or there's no evidence at
 * all, else PASS. It reasons only over what it was given, which by
 * construction excludes the generator's transcript.
 */
export class SimulatedRoleSeparatedReviewer implements RoleSeparatedReviewer {
  async review(input: RoleSeparatedReviewInput): Promise<RoleSeparatedReviewVerdict> {
    if (input.test_results.some((c) => c.status === "FAIL")) {
      return { status: "FAIL", rationale: "role-separated review: at least one shown test failed" };
    }
    if (input.test_results.some((c) => c.status === "UNKNOWN") || input.evidence_ids.length === 0) {
      return { status: "UNKNOWN", rationale: "role-separated review: unresolved checks or no evidence to review" };
    }
    return { status: "PASS", rationale: "role-separated review: frozen plan, change, tests, and evidence are consistent" };
  }
}
