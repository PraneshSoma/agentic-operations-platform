import { describe, expect, it } from "vitest";
import { buildSupersedingRecord, type SupersedingCorrection } from "./evidence-repository.js";
import { RETENTION_POLICY_VERSION } from "../retention/retention-policy.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function correction(overrides: Partial<SupersedingCorrection> = {}): SupersedingCorrection {
  return {
    request_id: "req_1",
    execution_id: "exec_1",
    type: "OBSERVATION",
    source: { component: "investigator" },
    content: { summary: "corrected observation" },
    retention_class: "evidence_record",
    ...overrides,
  };
}

describe("buildSupersedingRecord() — pure append-only correction builder (E-01, F-15)", () => {
  it("CRITICAL: points relationships.supersedes at the superseded record and mints a fresh evidence_id", () => {
    const record = buildSupersedingRecord("tenant_1", "ev_original", correction(), NOW);
    expect(record.relationships.supersedes).toBe("ev_original");
    expect(record.evidence_id).not.toBe("ev_original");
    expect(typeof record.evidence_id).toBe("string");
  });

  it("carries the correction's own content — the superseding record is the corrected data, not a copy of the original", () => {
    const record = buildSupersedingRecord("tenant_1", "ev_original", correction({ content: { summary: "the fixed value" } }), NOW);
    expect(record.content.summary).toBe("the fixed value");
  });

  it("populates retention fields from ADR-011's policy for the record's class", () => {
    const record = buildSupersedingRecord("tenant_1", "ev_original", correction({ retention_class: "evidence_record" }), NOW);
    expect(record.retention_policy_version).toBe(RETENTION_POLICY_VERSION);
    expect(record.legal_hold).toBe(false);
    // 90-day dev default for evidence_record.
    const expiresDays = Math.round((new Date(record.retention_expires_at).getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000));
    expect(expiresDays).toBe(90);
  });

  it("preserves other relationship kinds alongside supersedes when provided", () => {
    const record = buildSupersedingRecord("tenant_1", "ev_original", correction({ additional_relationships: { derived_from: ["ev_x"] } }), NOW);
    expect(record.relationships.derived_from).toEqual(["ev_x"]);
    expect(record.relationships.supersedes).toBe("ev_original");
  });

  it("stamps the tenant_id on the new record", () => {
    const record = buildSupersedingRecord("tenant_42", "ev_original", correction(), NOW);
    expect(record.tenant_id).toBe("tenant_42");
  });

  it("produces a schema-valid Evidence record (parses through EvidenceSchema without throwing)", () => {
    // buildSupersedingRecord parses internally; reaching here without a
    // throw is the assertion, plus a spot-check on a required field.
    const record = buildSupersedingRecord("tenant_1", "ev_original", correction(), NOW);
    expect(record.integrity.created_at).toBe(NOW.toISOString());
  });
});
