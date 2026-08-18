import { describe, expect, it } from "vitest";
import { RETENTION_POLICY_VERSION, computeRetention } from "./retention-policy.js";

const CREATED_AT = new Date("2026-08-18T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, iso: string): number {
  return Math.round((new Date(iso).getTime() - from.getTime()) / MS_PER_DAY);
}

describe("computeRetention() — ADR-011 class-differentiated dev retention (E-01)", () => {
  it("uses the 90-day dev default for operational_state and evidence_record (the headline classes)", () => {
    expect(daysBetween(CREATED_AT, computeRetention("operational_state", CREATED_AT).retention_expires_at)).toBe(90);
    expect(daysBetween(CREATED_AT, computeRetention("evidence_record", CREATED_AT).retention_expires_at)).toBe(90);
  });

  it("uses a shorter, more conservative default for prompts and secrets_redacted_payload", () => {
    expect(daysBetween(CREATED_AT, computeRetention("prompts", CREATED_AT).retention_expires_at)).toBe(30);
    expect(daysBetween(CREATED_AT, computeRetention("secrets_redacted_payload", CREATED_AT).retention_expires_at)).toBe(30);
  });

  it("uses a longer default for audit_hash — the chain outlives individual records", () => {
    expect(daysBetween(CREATED_AT, computeRetention("audit_hash", CREATED_AT).retention_expires_at)).toBe(365);
  });

  it("labels every result explicitly non-production via retention_policy_version", () => {
    for (const cls of ["prompts", "secrets_redacted_payload", "operational_state", "evidence_record", "audit_hash"] as const) {
      expect(computeRetention(cls, CREATED_AT).retention_policy_version).toBe(RETENTION_POLICY_VERSION);
    }
    expect(RETENTION_POLICY_VERSION).toContain("nonprod");
  });

  it("legal_hold always starts false — a hold is an explicit later action, never the default", () => {
    expect(computeRetention("evidence_record", CREATED_AT).legal_hold).toBe(false);
  });

  it("is deterministic — identical inputs yield an identical expiry", () => {
    const a = computeRetention("operational_state", CREATED_AT);
    const b = computeRetention("operational_state", CREATED_AT);
    expect(a).toEqual(b);
  });

  it("all classes are finite — no class returns an unbounded/indefinite retention (ADR-011's rejected Option B)", () => {
    for (const cls of ["prompts", "secrets_redacted_payload", "operational_state", "evidence_record", "audit_hash"] as const) {
      const expiresAt = new Date(computeRetention(cls, CREATED_AT).retention_expires_at).getTime();
      expect(Number.isFinite(expiresAt)).toBe(true);
      expect(expiresAt).toBeGreaterThan(CREATED_AT.getTime());
    }
  });
});
