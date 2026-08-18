import { describe, expect, it } from "vitest";
import { VerificationResultSchema } from "./verification-result.js";

const validPayload = {
  verification_id: "ver_1",
  execution_result_id: "res_1",
  checks: [
    { name: "UNIT_TEST", status: "PASS", evidence_ids: ["ev_1"] },
    { name: "ROLE_SEPARATED_REVIEW", status: "PASS", evidence_ids: ["ev_2"] },
  ],
  overall: "VERIFIED",
  recommended_next_step: "CLOSE",
};

describe("VerificationResultSchema", () => {
  it("accepts a valid payload matching spec §19's shape", () => {
    expect(VerificationResultSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts an empty checks array with an INCONCLUSIVE overall", () => {
    const inconclusive = { ...validPayload, checks: [], overall: "INCONCLUSIVE", recommended_next_step: "ESCALATE" };
    expect(VerificationResultSchema.safeParse(inconclusive).success).toBe(true);
  });

  it("accepts a FAILED overall with recommended_next_step: ROLLBACK", () => {
    const failed = {
      ...validPayload,
      checks: [{ name: "PREFLIGHT_DRIFT_CHECK", status: "FAIL", evidence_ids: [] }],
      overall: "FAILED",
      recommended_next_step: "ROLLBACK",
    };
    expect(VerificationResultSchema.safeParse(failed).success).toBe(true);
  });

  it("CRITICAL: rejects an out-of-enum checks[].name value — LLD-v1 §2 formalizes this enum (ADR-006) specifically so check names stay auditable/aggregable, not free text", () => {
    const broken = {
      ...validPayload,
      checks: [{ name: "VIBE_CHECK", status: "PASS", evidence_ids: [] }],
    };
    expect(VerificationResultSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum checks[].status value", () => {
    const broken = {
      ...validPayload,
      checks: [{ name: "UNIT_TEST", status: "MAYBE", evidence_ids: [] }],
    };
    expect(VerificationResultSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum overall value", () => {
    const broken = { ...validPayload, overall: "PROBABLY_FINE" };
    expect(VerificationResultSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum recommended_next_step value", () => {
    const broken = { ...validPayload, recommended_next_step: "IGNORE" };
    expect(VerificationResultSchema.safeParse(broken).success).toBe(false);
  });

  it.each(["verification_id", "execution_result_id", "checks", "overall", "recommended_next_step"])(
    "rejects when required field %s is missing",
    (field) => {
      const broken = structuredClone(validPayload) as Record<string, unknown>;
      delete broken[field];
      expect(VerificationResultSchema.safeParse(broken).success).toBe(false);
    },
  );
});
