import { EvidenceSchema, type Evidence } from "@aop/contracts";
import type { PrismaClient, Prisma, EvidenceRow } from "@prisma/client";
import { buildSupersedingRecord, type EvidenceRepository, type SupersedingCorrection } from "./evidence-repository.js";

/**
 * Prisma-backed EvidenceRepository (story E-01). The real Evidence Ledger
 * persistence — append-only, tenant-scoped, retention-populated.
 *
 * This file is verified by the .integration.test.ts suites against a
 * real Postgres (append-only-ness and cross-tenant isolation are DB-level
 * properties a mock cannot prove) — it is excluded from the default unit
 * coverage gate for the same reason the app process entrypoints
 * (apps, each src/index.ts) are: there's nothing here a dependency-free
 * unit test can meaningfully exercise. The pure logic it delegates to
 * (buildSupersedingRecord, computeRetention) IS unit-tested in the
 * default gate.
 */
export class PrismaEvidenceRepository implements EvidenceRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(evidence: Evidence): Promise<Evidence> {
    const created = await this.prisma.evidenceRow.create({ data: toRow(evidence) });
    return fromRow(created);
  }

  async supersede(tenantId: string, supersededEvidenceId: string, correction: SupersedingCorrection): Promise<Evidence> {
    // A correction is a NEW insert — the original row is never updated.
    const superseding = buildSupersedingRecord(tenantId, supersededEvidenceId, correction, this.now());
    const created = await this.prisma.evidenceRow.create({ data: toRow(superseding) });
    return fromRow(created);
  }

  async listForExecution(tenantId: string, executionId: string): Promise<Evidence[]> {
    const rows = await this.prisma.evidenceRow.findMany({
      where: { tenant_id: tenantId, execution_id: executionId },
      orderBy: { evidence_id: "asc" },
    });
    return rows.map(fromRow);
  }

  async getById(tenantId: string, evidenceId: string): Promise<Evidence | undefined> {
    const row = await this.prisma.evidenceRow.findUnique({ where: { evidence_id: evidenceId } });
    // Tenant filter applied in code as well as by the caller passing
    // tenant_id — a getById that ignored tenant would be a cross-tenant
    // leak (F-15's isolation invariant).
    return row && row.tenant_id === tenantId ? fromRow(row) : undefined;
  }
}

function toRow(evidence: Evidence): Prisma.EvidenceRowUncheckedCreateInput {
  // The four Json columns (source/content/relationships/integrity) are
  // already schema-validated domain objects (CONTEXT.md RULE 1); Prisma's
  // InputJsonValue index-signature type doesn't accept a struct with an
  // optional field directly, so each is asserted to InputJsonValue at this
  // storage boundary — the shape is guaranteed by EvidenceSchema upstream.
  const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
  return {
    evidence_id: evidence.evidence_id,
    tenant_id: evidence.tenant_id,
    request_id: evidence.request_id,
    execution_id: evidence.execution_id,
    type: evidence.type,
    source: json(evidence.source),
    content: json(evidence.content),
    relationships: json(evidence.relationships),
    integrity: json(evidence.integrity),
    retention_class: evidence.retention_class,
    retention_expires_at: new Date(evidence.retention_expires_at),
    retention_policy_version: evidence.retention_policy_version,
    legal_hold: evidence.legal_hold,
  };
}

function fromRow(row: EvidenceRow): Evidence {
  return EvidenceSchema.parse({
    evidence_id: row.evidence_id,
    tenant_id: row.tenant_id,
    request_id: row.request_id,
    execution_id: row.execution_id,
    type: row.type,
    source: row.source,
    content: row.content,
    relationships: row.relationships,
    integrity: row.integrity,
    retention_class: row.retention_class,
    retention_expires_at: row.retention_expires_at.toISOString(),
    retention_policy_version: row.retention_policy_version,
    legal_hold: row.legal_hold,
  });
}
