import {
  ConfidenceDimensionsSchema,
  type ConfidenceDimensions,
  type ContextPackage,
  type Evidence,
  type InvestigationResult,
  type VerificationResult,
} from "@aop/contracts";

/**
 * Assembles the five itemized confidence dimensions (spec §26, F-17,
 * story E-03) from the artifacts the pipeline already produces — the
 * Investigator's result, the execution's evidence set, the context
 * package, and (once it exists) the verification result. Pure and
 * deterministic.
 *
 * By construction it CANNOT collapse these into a single figure: it
 * returns a ConfidenceDimensionsSchema-validated object, which has no
 * rollup field. Every dimension is a categorical plus the integer counts
 * backing it — the itemized surface F-17 mandates until a numeric rollup
 * is empirically calibrated (Post-MVP, separately gated).
 */
export interface ConfidenceInput {
  investigation: InvestigationResult;
  /** The execution's evidence records — walked for contradicts relationships. */
  evidence: Evidence[];
  contextPackage: ContextPackage;
  /** Absent until the Verification Engine has run — surfaced as NOT_YET_VERIFIED, never an implicit pass. */
  verification?: VerificationResult;
}

export function assembleConfidenceDimensions(input: ConfidenceInput): ConfidenceDimensions {
  return ConfidenceDimensionsSchema.parse({
    evidence_coverage: evidenceCoverage(input.investigation),
    hypothesis_support: hypothesisSupport(input.investigation),
    contradictory_evidence: contradictoryEvidence(input.investigation, input.evidence),
    verification_confidence: verificationConfidence(input.verification),
    evidence_freshness: evidenceFreshness(input.contextPackage),
  });
}

function evidenceCoverage(investigation: InvestigationResult): ConfidenceDimensions["evidence_coverage"] {
  // A "claim" is an observation or the diagnosis; it's evidence-backed
  // when it cites at least one evidence_id.
  const claims: Array<{ evidence_ids: string[] }> = [
    ...investigation.observations.map((o) => ({ evidence_ids: o.evidence_ids })),
    { evidence_ids: investigation.diagnosis.evidence_ids },
  ];
  const total = claims.length;
  const backed = claims.filter((c) => c.evidence_ids.length > 0).length;

  let value: "HIGH" | "MEDIUM" | "LOW";
  if (backed === total) value = "HIGH";
  else if (backed === 0) value = "LOW";
  else value = "MEDIUM";

  return { value, evidence_backed_claim_count: backed, total_claim_count: total };
}

function hypothesisSupport(investigation: InvestigationResult): ConfidenceDimensions["hypothesis_support"] {
  const counts = { supported: 0, rejected: 0, unresolved: 0 };
  for (const h of investigation.hypotheses) counts[h.status] += 1;
  return counts;
}

function contradictoryEvidence(investigation: InvestigationResult, evidence: Evidence[]): ConfidenceDimensions["contradictory_evidence"] {
  const ids = new Set<string>();
  // From the Evidence corpus's own relationships.contradicts (§4.6).
  for (const record of evidence) {
    for (const id of record.relationships.contradicts ?? []) ids.add(id);
  }
  // From the hypotheses' contradicting_evidence_ids (§11).
  for (const h of investigation.hypotheses) {
    for (const id of h.contradicting_evidence_ids) ids.add(id);
  }
  const contradicting = [...ids].sort();
  return { count: contradicting.length, contradicting_evidence_ids: contradicting };
}

function verificationConfidence(verification: VerificationResult | undefined): ConfidenceDimensions["verification_confidence"] {
  if (!verification) {
    return { status: "NOT_YET_VERIFIED", pass: 0, fail: 0, unknown: 0 };
  }
  const counts = { pass: 0, fail: 0, unknown: 0 };
  for (const check of verification.checks) {
    if (check.status === "PASS") counts.pass += 1;
    else if (check.status === "FAIL") counts.fail += 1;
    else counts.unknown += 1;
  }
  return { status: verification.overall, ...counts };
}

function evidenceFreshness(contextPackage: ContextPackage): ConfidenceDimensions["evidence_freshness"] {
  const staleCount = contextPackage.stale_context.length;
  const missingCount = contextPackage.missing_context.length;

  let value: "FRESH" | "PARTIALLY_STALE" | "STALE";
  if (staleCount === 0 && missingCount === 0) value = "FRESH";
  else if (staleCount > 0) value = "STALE";
  else value = "PARTIALLY_STALE"; // missing but nothing actively stale

  return { value, stale_context_count: staleCount, missing_context_count: missingCount };
}
