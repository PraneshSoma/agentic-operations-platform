import { describe, expect, it } from "vitest";
import { ConfidenceDimensionsSchema } from "./confidence-dimensions.js";

const valid = {
  evidence_coverage: { value: "HIGH", evidence_backed_claim_count: 3, total_claim_count: 3 },
  hypothesis_support: { supported: 1, rejected: 0, unresolved: 2 },
  contradictory_evidence: { count: 1, contradicting_evidence_ids: ["ev_x"] },
  verification_confidence: { status: "VERIFIED", pass: 2, fail: 0, unknown: 0 },
  evidence_freshness: { value: "FRESH", stale_context_count: 0, missing_context_count: 0 },
};

describe("ConfidenceDimensionsSchema (E-03, F-17)", () => {
  it("accepts a valid itemized surface", () => {
    expect(ConfidenceDimensionsSchema.safeParse(valid).success).toBe(true);
  });

  it("CRITICAL: has no top-level numeric rollup field — the surface is exactly the five itemized dimensions", () => {
    const keys = Object.keys(ConfidenceDimensionsSchema.shape).sort();
    expect(keys).toEqual([
      "contradictory_evidence",
      "evidence_coverage",
      "evidence_freshness",
      "hypothesis_support",
      "verification_confidence",
    ]);
    // No score/confidence/percentage/value collapsed figure at the top level.
    expect(keys).not.toContain("score");
    expect(keys).not.toContain("confidence");
    expect(keys).not.toContain("percentage");
  });

  it.each(["HIGH", "MEDIUM", "LOW"])("accepts evidence_coverage value %s", (value) => {
    expect(ConfidenceDimensionsSchema.safeParse({ ...valid, evidence_coverage: { ...valid.evidence_coverage, value } }).success).toBe(true);
  });

  it.each(["VERIFIED", "FAILED", "INCONCLUSIVE", "NOT_YET_VERIFIED"])("accepts verification_confidence status %s", (status) => {
    expect(ConfidenceDimensionsSchema.safeParse({ ...valid, verification_confidence: { ...valid.verification_confidence, status } }).success).toBe(true);
  });

  it.each(["FRESH", "PARTIALLY_STALE", "STALE"])("accepts evidence_freshness value %s", (value) => {
    expect(ConfidenceDimensionsSchema.safeParse({ ...valid, evidence_freshness: { ...valid.evidence_freshness, value } }).success).toBe(true);
  });

  it("rejects an out-of-enum evidence_coverage value", () => {
    expect(ConfidenceDimensionsSchema.safeParse({ ...valid, evidence_coverage: { ...valid.evidence_coverage, value: "VERY_HIGH" } }).success).toBe(false);
  });

  it.each(["evidence_coverage", "hypothesis_support", "contradictory_evidence", "verification_confidence", "evidence_freshness"])(
    "rejects when required dimension %s is missing",
    (field) => {
      const broken = structuredClone(valid) as Record<string, unknown>;
      delete broken[field];
      expect(ConfidenceDimensionsSchema.safeParse(broken).success).toBe(false);
    },
  );
});
