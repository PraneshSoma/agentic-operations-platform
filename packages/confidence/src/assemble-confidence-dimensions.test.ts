import { describe, expect, it } from "vitest";
import type { ContextPackage, Evidence, InvestigationResult, VerificationResult } from "@aop/contracts";
import { assembleConfidenceDimensions } from "./assemble-confidence-dimensions.js";

const NOW = "2026-08-18T12:00:00.000Z";

function investigation(overrides: Partial<InvestigationResult> = {}): InvestigationResult {
  return {
    observations: [
      { id: "obs_1", statement: "error rate up", evidence_ids: ["ev_1"] },
      { id: "obs_2", statement: "deploy happened", evidence_ids: ["ev_2"] },
    ],
    hypotheses: [
      { id: "hyp_1", description: "deploy regression", supporting_evidence_ids: ["ev_2"], contradicting_evidence_ids: [], status: "supported" },
      { id: "hyp_2", description: "infra flake", supporting_evidence_ids: [], contradicting_evidence_ids: ["ev_3"], status: "rejected" },
      { id: "hyp_3", description: "upstream dep", supporting_evidence_ids: [], contradicting_evidence_ids: [], status: "unresolved" },
    ],
    diagnosis: { summary: "deploy-induced spike", evidence_ids: ["ev_1", "ev_2"] },
    missing_information: [],
    recommended_next_step: "PLAN",
    ...overrides,
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidence_id: "ev_1",
    tenant_id: "tenant_1",
    request_id: "req_1",
    execution_id: "exec_1",
    type: "OBSERVATION",
    source: { component: "connector" },
    content: { summary: "log line" },
    relationships: {},
    integrity: { created_at: NOW, content_hash: "sha256:x" },
    retention_class: "evidence_record",
    retention_expires_at: NOW,
    retention_policy_version: "dev-nonprod-v0",
    legal_hold: false,
    ...overrides,
  };
}

function contextPackage(overrides: Partial<ContextPackage> = {}): ContextPackage {
  return {
    context_package_id: "ctx_1",
    tenant_id: "tenant_1",
    request_id: "req_1",
    opc_id: "opc_1",
    assembled_at: NOW,
    application_context: {
      application_id: "checkout", name: "Checkout", owners: [], environments: ["prod"],
      dependencies: { upstream: [], downstream: [] }, apis: [], datastores: [], messaging: [], slo_refs: [], approved_action_refs: [], change_context: {},
    },
    runtime_context: {
      time_window: { from: NOW, to: NOW }, logs: { summaries: [], evidence_refs: [] }, metrics: [], traces: { summaries: [] }, deployment_state: {},
    },
    historical_evidence: { similar_cases: [], aggregate: { precedent_count: 0, verified_success_count: 0, failure_count: 0, rollback_count: 0 } },
    missing_context: [],
    stale_context: [],
    provenance: [],
    ...overrides,
  };
}

function verification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    verification_id: "ver_1",
    execution_result_id: "res_1",
    checks: [
      { name: "PRODUCTION_EVIDENCE", status: "PASS", evidence_ids: [] },
      { name: "POLICY_CHECK", status: "PASS", evidence_ids: [] },
    ],
    overall: "VERIFIED",
    recommended_next_step: "CLOSE",
    ...overrides,
  };
}

describe("assembleConfidenceDimensions() — the itemized confidence surface (E-03, F-17)", () => {
  it("CRITICAL: surfaces all five dimensions individually, with no numeric rollup field anywhere", () => {
    const dims = assembleConfidenceDimensions({ investigation: investigation(), evidence: [], contextPackage: contextPackage() });
    expect(Object.keys(dims).sort()).toEqual([
      "contradictory_evidence",
      "evidence_coverage",
      "evidence_freshness",
      "hypothesis_support",
      "verification_confidence",
    ]);
    // Deep-scan: no key named score/confidence/percentage/overall_score at any level.
    const flat = JSON.stringify(dims);
    expect(flat).not.toMatch(/"score"/);
    expect(flat).not.toMatch(/"confidence"/);
    expect(flat).not.toMatch(/"percentage"/);
  });

  it("evidence_coverage is HIGH when every claim is evidence-backed", () => {
    const dims = assembleConfidenceDimensions({ investigation: investigation(), evidence: [], contextPackage: contextPackage() });
    expect(dims.evidence_coverage).toEqual({ value: "HIGH", evidence_backed_claim_count: 3, total_claim_count: 3 });
  });

  it("evidence_coverage is LOW when no claim is evidence-backed", () => {
    const inv = investigation({
      observations: [{ id: "o", statement: "x", evidence_ids: [] }],
      diagnosis: { summary: "d", evidence_ids: [] },
    });
    const dims = assembleConfidenceDimensions({ investigation: inv, evidence: [], contextPackage: contextPackage() });
    expect(dims.evidence_coverage.value).toBe("LOW");
  });

  it("evidence_coverage is MEDIUM when some but not all claims are backed", () => {
    const inv = investigation({
      observations: [{ id: "o", statement: "x", evidence_ids: ["ev_1"] }],
      diagnosis: { summary: "d", evidence_ids: [] },
    });
    const dims = assembleConfidenceDimensions({ investigation: inv, evidence: [], contextPackage: contextPackage() });
    expect(dims.evidence_coverage.value).toBe("MEDIUM");
  });

  it("hypothesis_support counts supported/rejected/unresolved from the hypotheses", () => {
    const dims = assembleConfidenceDimensions({ investigation: investigation(), evidence: [], contextPackage: contextPackage() });
    expect(dims.hypothesis_support).toEqual({ supported: 1, rejected: 1, unresolved: 1 });
  });

  it("contradictory_evidence unions Evidence.relationships.contradicts and hypotheses' contradicting_evidence_ids, de-duped and sorted", () => {
    const dims = assembleConfidenceDimensions({
      investigation: investigation(), // hyp_2 contradicts ev_3
      evidence: [evidence({ relationships: { contradicts: ["ev_9", "ev_3"] } })], // ev_3 dup, ev_9 new
      contextPackage: contextPackage(),
    });
    expect(dims.contradictory_evidence).toEqual({ count: 2, contradicting_evidence_ids: ["ev_3", "ev_9"] });
  });

  it("CRITICAL: verification_confidence is NOT_YET_VERIFIED (never an implicit pass) when verification hasn't run", () => {
    const dims = assembleConfidenceDimensions({ investigation: investigation(), evidence: [], contextPackage: contextPackage() });
    expect(dims.verification_confidence).toEqual({ status: "NOT_YET_VERIFIED", pass: 0, fail: 0, unknown: 0 });
  });

  it("verification_confidence carries the overall verdict and pass/fail/unknown counts when present", () => {
    const dims = assembleConfidenceDimensions({
      investigation: investigation(),
      evidence: [],
      contextPackage: contextPackage(),
      verification: verification({
        overall: "INCONCLUSIVE",
        checks: [
          { name: "PRODUCTION_EVIDENCE", status: "PASS", evidence_ids: [] },
          { name: "POLICY_CHECK", status: "FAIL", evidence_ids: [] },
          { name: "STATIC_ANALYSIS", status: "UNKNOWN", evidence_ids: [] },
        ],
      }),
    });
    expect(dims.verification_confidence).toEqual({ status: "INCONCLUSIVE", pass: 1, fail: 1, unknown: 1 });
  });

  it("evidence_freshness is FRESH when nothing is missing or stale", () => {
    const dims = assembleConfidenceDimensions({ investigation: investigation(), evidence: [], contextPackage: contextPackage() });
    expect(dims.evidence_freshness).toEqual({ value: "FRESH", stale_context_count: 0, missing_context_count: 0 });
  });

  it("evidence_freshness is STALE when any context is actively stale", () => {
    const dims = assembleConfidenceDimensions({
      investigation: investigation(),
      evidence: [],
      contextPackage: contextPackage({ stale_context: [{ source: "metrics", age_seconds: 600, max_age_seconds: 300 }] }),
    });
    expect(dims.evidence_freshness.value).toBe("STALE");
    expect(dims.evidence_freshness.stale_context_count).toBe(1);
  });

  it("evidence_freshness is PARTIALLY_STALE when context is missing but nothing is actively stale", () => {
    const dims = assembleConfidenceDimensions({
      investigation: investigation(),
      evidence: [],
      contextPackage: contextPackage({ missing_context: [{ source: "logs", reason: "connector down", required: false }] }),
    });
    expect(dims.evidence_freshness.value).toBe("PARTIALLY_STALE");
    expect(dims.evidence_freshness.missing_context_count).toBe(1);
  });

  it("is deterministic — identical inputs yield identical dimensions", () => {
    const input = { investigation: investigation(), evidence: [evidence()], contextPackage: contextPackage() };
    expect(assembleConfidenceDimensions(input)).toEqual(assembleConfidenceDimensions(input));
  });
});
