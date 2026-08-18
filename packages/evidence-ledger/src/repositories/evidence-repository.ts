import { randomUUID } from "node:crypto";
import { EvidenceSchema, type Evidence } from "@aop/contracts";
import { computeRetention } from "../retention/retention-policy.js";

/**
 * EvidenceRepository (spec §21, F-15, story E-01) — the append-only
 * Evidence Ledger persistence boundary. Interface + a pure record-builder
 * here; the Prisma-backed implementation is in
 * `prisma-evidence-repository.ts` (integration-tested against a real
 * Postgres, since append-only-ness and tenant isolation are DB-level
 * properties a mock can't prove).
 *
 * Append-only invariant (spec §21 "Evidence records should be append-only
 * for v0.1. Corrections create a new record referencing the superseded
 * evidence."): there is deliberately NO `update()` method on this
 * interface. A correction goes through `supersede()`, which inserts a
 * NEW row whose `relationships.supersedes` points at the record it
 * replaces — the original row is never mutated.
 */
export interface EvidenceRepository {
  /** Inserts a new evidence record. Never updates an existing one. */
  record(evidence: Evidence): Promise<Evidence>;
  /**
   * Records a correction: inserts a NEW evidence record superseding
   * `supersededEvidenceId`, never touching the original row. Returns the
   * new record.
   */
  supersede(tenantId: string, supersededEvidenceId: string, correction: SupersedingCorrection): Promise<Evidence>;
  /** Tenant-scoped read — one execution's full evidence chain (spec §34's reconstructability criterion). */
  listForExecution(tenantId: string, executionId: string): Promise<Evidence[]>;
  getById(tenantId: string, evidenceId: string): Promise<Evidence | undefined>;
}

/** The caller-supplied fields of a correction — everything except identity/retention/supersedes, which the repository fills in. */
export interface SupersedingCorrection {
  request_id: string;
  execution_id: string;
  type: Evidence["type"];
  source: Evidence["source"];
  content: Evidence["content"];
  retention_class: Evidence["retention_class"];
  additional_relationships?: Omit<Evidence["relationships"], "supersedes">;
}

/**
 * Pure builder for a superseding record (unit-testable without a DB).
 * Produces a schema-valid Evidence with a fresh evidence_id,
 * `relationships.supersedes` set to `[supersededEvidenceId]`, and
 * retention fields computed from ADR-011's policy — never mutates or
 * references the original record's identity beyond pointing at it.
 */
export function buildSupersedingRecord(
  tenantId: string,
  supersededEvidenceId: string,
  correction: SupersedingCorrection,
  now: Date,
): Evidence {
  const retention = computeRetention(correction.retention_class, now);
  return EvidenceSchema.parse({
    evidence_id: randomUUID(),
    tenant_id: tenantId,
    request_id: correction.request_id,
    execution_id: correction.execution_id,
    type: correction.type,
    source: correction.source,
    content: correction.content,
    relationships: { ...correction.additional_relationships, supersedes: supersededEvidenceId },
    integrity: {
      created_at: now.toISOString(),
      content_hash: `sha256:placeholder-${tenantId}-${supersededEvidenceId}-${now.getTime()}`,
    },
    retention_class: correction.retention_class,
    retention_expires_at: retention.retention_expires_at,
    retention_policy_version: retention.retention_policy_version,
    legal_hold: retention.legal_hold,
  });
}
