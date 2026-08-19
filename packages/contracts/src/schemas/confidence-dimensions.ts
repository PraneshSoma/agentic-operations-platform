import { z } from "zod";

/**
 * ConfidenceDimensions (spec §26, F-17, story E-03) — the itemized
 * confidence surface. Spec §26 opens with "Avoid one ambiguous
 * `confidence: 0.87`" and F-17 (Requirements Rev2) hard-gates any single
 * numeric rollup behind empirical calibration against historical verified
 * outcomes. So this schema, BY CONSTRUCTION, has no place to put a
 * collapsed confidence figure: there is no top-level `score` / `value` /
 * `percentage` field. Each of the five dimensions carries only
 * categoricals, integer counts of underlying facts, and id lists — never
 * a derived 0-1 or 0-100 confidence number. A future calibrated rollup
 * (Post-MVP) would be an additive, separately-gated field, not a change
 * to this itemized surface.
 *
 * Story E-04 adds the two dimensions the Requirements Rev2 table left
 * "undefined (OI-REQ-08/09)": source_reliability (ADR-007) and
 * policy_certainty (ADR-008). Both are categorical/ordinal — never
 * decimals — keeping the whole surface rollup-free.
 */
export const ConfidenceDimensionsSchema = z.object({
  // 1. Evidence coverage (§26 ReasoningAssessment.evidence_coverage).
  evidence_coverage: z.object({
    value: z.enum(["HIGH", "MEDIUM", "LOW"]),
    evidence_backed_claim_count: z.number().int(),
    total_claim_count: z.number().int(),
  }),

  // 2. Hypothesis support (§11 InvestigationResult.hypotheses[].status).
  hypothesis_support: z.object({
    supported: z.number().int(),
    rejected: z.number().int(),
    unresolved: z.number().int(),
  }),

  // 3. Contradictory evidence (§4.6 Evidence.relationships.contradicts +
  //    §11 hypotheses[].contradicting_evidence_ids).
  contradictory_evidence: z.object({
    count: z.number().int(),
    contradicting_evidence_ids: z.array(z.string()),
  }),

  // 4. Verification confidence (§19 VerificationResult.checks[].status).
  //    NOT_YET_VERIFIED when verification hasn't run — never an implicit
  //    "verified", the same discipline as D-03's own INCONCLUSIVE default.
  verification_confidence: z.object({
    status: z.enum(["VERIFIED", "FAILED", "INCONCLUSIVE", "NOT_YET_VERIFIED"]),
    pass: z.number().int(),
    fail: z.number().int(),
    unknown: z.number().int(),
  }),

  // 5. Evidence freshness (§10 ContextPackage staleness marking).
  evidence_freshness: z.object({
    value: z.enum(["FRESH", "PARTIALLY_STALE", "STALE"]),
    stale_context_count: z.number().int(),
    missing_context_count: z.number().int(),
  }),

  // 6. Source reliability (ADR-007, story E-04). ORDINAL levels, NEVER
  //    decimals ("an uncalibrated 0.83 claims scientific precision the
  //    data doesn't support"). Keyed per contributing source to
  //    (connector_id, connector_version); `lowest` is the honest ordinal
  //    worst-case across sources, not an averaged number.
  source_reliability: z.object({
    lowest: z.enum(["LOW", "MEDIUM", "HIGH", "AUTHORITATIVE"]).nullable(),
    per_source: z.array(
      z.object({
        connector_id: z.string(),
        connector_version: z.string(),
        reliability_level: z.enum(["LOW", "MEDIUM", "HIGH", "AUTHORITATIVE"]),
      }),
    ),
  }),

  // 7. Policy certainty (ADR-008, story E-04). CATEGORICAL from
  //    PolicyDecision.outcome — DENY is carried as DENY, never rendered as
  //    merely "low confidence." NOT_YET_EVALUATED before policy runs, never
  //    an implicit ALLOW. hard_deny_reason_code accompanies a DENY.
  policy_certainty: z.object({
    outcome: z.enum(["ALLOW", "REQUIRE_APPROVAL", "DENY", "NOT_YET_EVALUATED"]),
    hard_deny_reason_code: z.string().nullable(),
  }),
});

export type ConfidenceDimensions = z.infer<typeof ConfidenceDimensionsSchema>;
