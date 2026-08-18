import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Evidence } from "@aop/contracts";
import { PrismaEvidenceRepository } from "./prisma-evidence-repository.js";
import { computeRetention } from "../retention/retention-policy.js";

/**
 * Real-Postgres integration coverage for the append-only EvidenceRepository
 * (story E-01, F-15). Runs against the DATABASE_URL Postgres — in CI a
 * testcontainer (see schema.integration.test.ts's disclosure), locally an
 * apt/service Postgres. Gated behind VITEST_INTEGRATION (vitest.config.ts),
 * so the default `pnpm test` gate stays dependency-free.
 *
 * These assertions — that a correction never mutates the original row, and
 * that a getById for the wrong tenant returns nothing — are DB-level
 * properties, which is exactly why they live here against a real database
 * rather than against the in-memory unit tests.
 */
const NOW = new Date("2026-08-18T12:00:00.000Z");
const TENANT = `tenant_e01_${randomUUID().slice(0, 8)}`;

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidence_id: randomUUID(),
    tenant_id: TENANT,
    request_id: "req_1",
    execution_id: "exec_1",
    type: "OBSERVATION",
    source: { component: "investigator" },
    content: { summary: "original observation" },
    relationships: {},
    integrity: { created_at: NOW.toISOString(), content_hash: "sha256:orig" },
    retention_class: "evidence_record",
    ...computeRetention("evidence_record", NOW),
    ...overrides,
  };
}

describe("PrismaEvidenceRepository — append-only Evidence Ledger (E-01, F-15)", () => {
  let prisma: PrismaClient;
  let repo: PrismaEvidenceRepository;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.tenant.create({ data: { id: TENANT, name: "E-01 test tenant" } });
    repo = new PrismaEvidenceRepository(prisma, () => NOW);
  });

  afterAll(async () => {
    await prisma.evidenceRow.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.tenant.delete({ where: { id: TENANT } });
    await prisma.$disconnect();
  });

  it("record() persists a retrievable evidence row with retention fields populated per ADR-011", async () => {
    const original = evidence();
    await repo.record(original);

    const fetched = await repo.getById(TENANT, original.evidence_id);
    expect(fetched).toBeDefined();
    expect(fetched?.retention_policy_version).toBe("dev-nonprod-v0");
    expect(fetched?.legal_hold).toBe(false);
    const expiresDays = Math.round((new Date(fetched!.retention_expires_at).getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000));
    expect(expiresDays).toBe(90); // evidence_record dev default
  });

  it("CRITICAL (F-15): supersede() inserts a NEW row with relationships.supersedes set and NEVER mutates the original", async () => {
    const original = evidence({ content: { summary: "the original, un-corrected value" } });
    await repo.record(original);

    const correction = await repo.supersede(TENANT, original.evidence_id, {
      request_id: "req_1",
      execution_id: "exec_1",
      type: "OBSERVATION",
      source: { component: "investigator" },
      content: { summary: "the corrected value" },
      retention_class: "evidence_record",
    });

    // The correction is a distinct new row pointing at the original.
    expect(correction.evidence_id).not.toBe(original.evidence_id);
    expect(correction.relationships.supersedes).toBe(original.evidence_id);
    expect(correction.content.summary).toBe("the corrected value");

    // The original row is untouched — still present, still its old value.
    const originalStill = await repo.getById(TENANT, original.evidence_id);
    expect(originalStill?.content.summary).toBe("the original, un-corrected value");
    expect(originalStill?.relationships.supersedes).toBeUndefined();
  });

  it("listForExecution() returns only the requested tenant+execution's records", async () => {
    const execId = `exec_${randomUUID().slice(0, 8)}`;
    await repo.record(evidence({ execution_id: execId }));
    await repo.record(evidence({ execution_id: execId }));
    await repo.record(evidence({ execution_id: "some_other_execution" }));

    const rows = await repo.listForExecution(TENANT, execId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.execution_id === execId)).toBe(true);
  });

  it("CRITICAL (F-15 isolation): getById() for the wrong tenant returns undefined even when the evidence_id exists", async () => {
    const original = evidence();
    await repo.record(original);
    expect(await repo.getById("some_other_tenant", original.evidence_id)).toBeUndefined();
  });

  it("getById() returns undefined for an evidence_id that was never recorded", async () => {
    expect(await repo.getById(TENANT, "never_recorded")).toBeUndefined();
  });
});
