import {
  ConfidenceDimensionsSchema,
  type ConfidenceDimensions,
  type ConnectorDescriptor,
  type ContextPackage,
  type Evidence,
  type InvestigationResult,
  type PolicyDecision,
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
  /** The connectors that contributed context — their ordinal reliability_level feeds source_reliability (ADR-007). */
  connectorDescriptors?: ConnectorDescriptor[];
  /** Absent until the Policy Engine has run — surfaced as NOT_YET_EVALUATED, never an implicit ALLOW. */
  policyDecision?: PolicyDecision;
}

export function assembleConfidenceDimensions(input: ConfidenceInput): ConfidenceDimensions {
  return ConfidenceDimensionsSchema.parse({
    evidence_coverage: evidenceCoverage(input.investigation),
    hypothesis_support: hypothesisSupport(input.investigation),
    contradictory_evidence: contradictoryEvidence(input.investigation, input.evidence),
    verification_confidence: verificationConfidence(input.verification),
    evidence_freshness: evidenceFreshness(input.contextPackage),
    source_reliability: sourceReliability(input.connectorDescriptors ?? []),
    policy_certainty: policyCertainty(input.policyDecision),
  });
}

const RELIABILITY_ORDER = ["LOW", "MEDIUM", "HIGH", "AUTHORITATIVE"] as const;
type ReliabilityLevel = (typeof RELIABILITY_ORDER)[number];

function sourceReliability(descriptors: ConnectorDescriptor[]): ConfidenceDimensions["source_reliability"] {
  // Keyed per source to (connector_id, connector_version) — ADR-007's
  // granularity, never a global type-level lookup. `lowest` is the honest
  // ordinal worst-case (min level), not an averaged decimal.
  const per_source = descriptors.map((d) => ({
    connector_id: d.connector_id,
    connector_version: d.definition_version,
    reliability_level: d.reliability_level,
  }));

  let lowest: ReliabilityLevel | null = null;
  for (const source of per_source) {
    if (lowest === null || RELIABILITY_ORDER.indexOf(source.reliability_level) < RELIABILITY_ORDER.indexOf(lowest)) {
      lowest = source.reliability_level;
    }
  }

  return { lowest, per_source };
}

function policyCertainty(policyDecision: PolicyDecision | undefined): ConfidenceDimensions["policy_certainty"] {
  if (!policyDecision) {
    return { outcome: "NOT_YET_EVALUATED", hard_deny_reason_code: null };
  }
  // Categorical passthrough — a DENY is carried as DENY (ADR-008), never
  // remapped to a "low confidence" figure. hard_deny_reason_code rides
  // along when present so the reason is visible, not flattened away.
  return { outcome: policyDecision.outcome, hard_deny_reason_code: policyDecision.hard_deny_reason_code ?? null };
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
