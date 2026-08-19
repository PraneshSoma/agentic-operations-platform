import { describe, expect, it } from "vitest";
import type { ResolutionPlan } from "@aop/contracts";
import {
  ROLE_SEPARATED_REVIEW_CHECK_NAME,
  ROLE_SEPARATED_REVIEW_LABEL,
  RoleSeparatedReviewInputSchema,
  SimulatedRoleSeparatedReviewer,
  runRoleSeparatedReview,
  type RoleSeparatedReviewInput,
  type RoleSeparatedReviewer,
} from "./role-separated-review.js";

const frozenPlan: ResolutionPlan = {
  plan_id: "plan_1",
  diagnosis_ref: "diag_1",
  steps: [{ step_id: "step_1", type: "ACTION", description: "restart", action_ref: "restart_service", parameters: { version: "1.3.0" } }],
  expected_outcome: "error rate returns to baseline",
  unresolved_risks: [],
};

function input(overrides: Partial<RoleSeparatedReviewInput> = {}): RoleSeparatedReviewInput {
  return {
    frozen_plan: frozenPlan,
    proposed_change: { action_ref: "restart_service", parameters: { version: "1.3.0" } },
    test_results: [{ name: "PREFLIGHT_DRIFT_CHECK", status: "PASS" }],
    evidence_ids: ["ev_1"],
    ...overrides,
  };
}

describe("Role-separated review — context isolation + terminology (E-04, ADR-006)", () => {
  it("CRITICAL: the reviewer input has NO reasoning-transcript field — the generator's chain-of-thought cannot be handed to it", () => {
    const keys = Object.keys(RoleSeparatedReviewInputSchema.shape).sort();
    expect(keys).toEqual(["evidence_ids", "frozen_plan", "proposed_change", "test_results"]);
    // The forbidden fields ADR-006 excludes are structurally absent.
    for (const forbidden of ["reasoning_transcript", "chain_of_thought", "diagnosis_reasoning", "reasoning", "transcript"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("CRITICAL: terminology is 'role-separated', never 'independent' — the user-facing label and check name both avoid the word", () => {
    expect(ROLE_SEPARATED_REVIEW_LABEL.toLowerCase()).not.toContain("independent");
    expect(ROLE_SEPARATED_REVIEW_LABEL.toLowerCase()).toContain("role-separated");
    expect(ROLE_SEPARATED_REVIEW_CHECK_NAME).toBe("ROLE_SEPARATED_REVIEW");
    expect(ROLE_SEPARATED_REVIEW_CHECK_NAME).not.toContain("INDEPENDENT");
  });

  it("packages the reviewer's verdict as a ROLE_SEPARATED_REVIEW verification check", async () => {
    const result = await runRoleSeparatedReview(input(), new SimulatedRoleSeparatedReviewer());
    expect(result.check.name).toBe("ROLE_SEPARATED_REVIEW");
    expect(result.check.status).toBe("PASS");
    expect(result.check.evidence_ids).toEqual(["ev_1"]);
  });

  it("hands the reviewer exactly the input it was given — nothing more", async () => {
    let seen: RoleSeparatedReviewInput | undefined;
    const spy: RoleSeparatedReviewer = {
      async review(i) {
        seen = i;
        return { status: "PASS", rationale: "ok" };
      },
    };
    const given = input();
    await runRoleSeparatedReview(given, spy);
    expect(seen).toBe(given);
    // No transcript field materialized onto what the reviewer saw.
    expect(Object.keys(seen ?? {})).not.toContain("reasoning_transcript");
  });

  describe("SimulatedRoleSeparatedReviewer — transparent, testable verdict rule", () => {
    it("FAIL when any shown test failed", async () => {
      const verdict = await new SimulatedRoleSeparatedReviewer().review(input({ test_results: [{ name: "POLICY_CHECK", status: "FAIL" }] }));
      expect(verdict.status).toBe("FAIL");
    });

    it("UNKNOWN when a shown test is unknown", async () => {
      const verdict = await new SimulatedRoleSeparatedReviewer().review(input({ test_results: [{ name: "POLICY_CHECK", status: "UNKNOWN" }] }));
      expect(verdict.status).toBe("UNKNOWN");
    });

    it("UNKNOWN when there is no evidence to review", async () => {
      const verdict = await new SimulatedRoleSeparatedReviewer().review(input({ evidence_ids: [] }));
      expect(verdict.status).toBe("UNKNOWN");
    });

    it("PASS when tests are all clean and evidence exists", async () => {
      const verdict = await new SimulatedRoleSeparatedReviewer().review(input());
      expect(verdict.status).toBe("PASS");
    });
  });
});
