import type { Evidence } from "@aop/contracts";

/**
 * ADR-011's class-differentiated, finite, DEVELOPMENT-ONLY retention
 * policy (story E-01). Pure — no Prisma, no I/O — so it's unit-testable
 * and reusable by both the Prisma persistence layer here and the
 * orchestrator's evidence writes (apps/worker), replacing the naive
 * fixed-30-day placeholder those stories (B-03/D-06) disclosed as
 * "E-01's job."
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ DEVELOPMENT-ONLY TEMPORARY BEHAVIOR — NOT AN APPROVED PRODUCTION   ║
 * ║ DEFAULT (ADR-011). No tenant may go to production on these values: ║
 * ║ the tenant-activation gate (E-07) blocks activation until a real,  ║
 * ║ per-class retention decision is recorded. `retention_policy_version║
 * ║ = "dev-nonprod-v0"` is the machine-readable marker of that fact.   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Class-differentiated per ADR-011 ("an audit hash chain plausibly wants
 * to live longest; a raw prompt log plausibly wants the shortest, most
 * conservative default") — NOT one blanket policy. 90 days is the
 * headline dev default (operational state / evidence records); prompts
 * and redacted payloads are shorter (most conservative), audit hashes
 * longer (the chain outlives individual records).
 */
export const RETENTION_POLICY_VERSION = "dev-nonprod-v0";

type RetentionClass = Evidence["retention_class"];

const DEV_RETENTION_DAYS_BY_CLASS: Record<RetentionClass, number> = {
  prompts: 30,
  secrets_redacted_payload: 30,
  operational_state: 90,
  evidence_record: 90,
  audit_hash: 365,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RetentionFields {
  retention_expires_at: string;
  retention_policy_version: string;
  legal_hold: boolean;
}

/**
 * Computes the three retention fields (LLD-v1 §2, ADR-011) for a record
 * of the given class created at `createdAt`. Deterministic: identical
 * inputs yield an identical expiry. `legal_hold` always starts `false` —
 * a hold is an explicit, audited later action (ADR-011), never the
 * default state of a record.
 */
export function computeRetention(retentionClass: RetentionClass, createdAt: Date): RetentionFields {
  const days = DEV_RETENTION_DAYS_BY_CLASS[retentionClass];
  return {
    retention_expires_at: new Date(createdAt.getTime() + days * MS_PER_DAY).toISOString(),
    retention_policy_version: RETENTION_POLICY_VERSION,
    legal_hold: false,
  };
}
