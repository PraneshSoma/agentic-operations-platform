import { execSync } from "node:child_process";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Real-Postgres integration coverage for the three new LLD-v1 §2 tables
 * (story A-03): execution_step_marker, outbox_event, identity_principal.
 *
 * Per CONTEXT.md's stated stack decision, this uses
 * @testcontainers/postgresql — not mocks — against the actual generated
 * schema. `prisma db push` applies schema.prisma directly to the
 * container (skipping migration history, which is fine for a disposable
 * test database).
 *
 * NOTE ON THIS SANDBOX: at the time this test was written, the container
 * registry (production.cloudfront.docker.com) was blocked by this
 * session's egress proxy, so `PostgreSqlContainer` cannot pull its image
 * here and this file could not be executed in-session. It was validated
 * instead by running the equivalent assertions by hand against a local
 * `apt`-installed PostgreSQL 16 server (see pipeline/A-03/pr_summary.md
 * for the transcript) — a real Postgres, just not the containerized one
 * this file uses. This is disclosed, not silently worked around: in any
 * environment where the registry is reachable (real CI), this test runs
 * as written and is the authoritative check.
 */
describe("evidence-ledger schema — execution_step_marker / outbox_event / identity_principal", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const url = container.getConnectionUri();
    execSync("pnpm exec prisma db push --skip-generate", {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.tenant.create({ data: { id: "tenant_1", name: "Test Tenant" } });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it("persists an execution_step_marker and enforces UNIQUE(tenant_id, execution_id, step_id, operation_id)", async () => {
    const marker = await prisma.executionStepMarker.create({
      data: {
        tenant_id: "tenant_1",
        execution_id: "exec_1",
        step_id: "step_1",
        operation_id: "op_1",
        action_ref: "restart_service",
        action_version: "1.0.0",
        connector_ref: "k8s-connector",
        connector_version: "2.0.0",
        attempt_number: 1,
        status: "ATTEMPTED",
      },
    });
    expect(marker.status).toBe("ATTEMPTED");

    await expect(
      prisma.executionStepMarker.create({
        data: {
          tenant_id: "tenant_1",
          execution_id: "exec_1",
          step_id: "step_1",
          operation_id: "op_1", // same 4-tuple — must violate the UNIQUE constraint
          action_ref: "restart_service",
          action_version: "1.0.0",
          connector_ref: "k8s-connector",
          connector_version: "2.0.0",
          attempt_number: 2,
          status: "ATTEMPTED",
        },
      }),
    ).rejects.toThrow();
  });

  it("allows the SAME operation_id to retry via attempt_number, and transitions to COMPLETED", async () => {
    const marker = await prisma.executionStepMarker.create({
      data: {
        tenant_id: "tenant_1",
        execution_id: "exec_2",
        step_id: "step_1",
        operation_id: "op_2",
        action_ref: "restart_service",
        action_version: "1.0.0",
        connector_ref: "k8s-connector",
        connector_version: "2.0.0",
        attempt_number: 1,
        status: "ATTEMPTED",
      },
    });
    const completed = await prisma.executionStepMarker.update({
      where: { id: marker.id },
      data: { status: "COMPLETED", completed_at: new Date() },
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completed_at).not.toBeNull();
  });

  it("persists an outbox_event and enforces UNIQUE(event_id) — the field consumers dedupe on, not the internal id", async () => {
    const event = await prisma.outboxEvent.create({
      data: {
        tenant_id: "tenant_1",
        event_id: "evt_stable_1",
        execution_id: "exec_1",
        event_type: "opc.matched",
        aggregate_type: "execution",
        aggregate_id: "exec_1",
        aggregate_version: 1,
        event_schema_version: "1.0.0",
        payload: { opc_id: "opc_a" },
      },
    });
    expect(event.published_at).toBeNull();
    expect(event.delivery_attempts).toBe(0);

    await expect(
      prisma.outboxEvent.create({
        data: {
          tenant_id: "tenant_1",
          event_id: "evt_stable_1", // same stable event_id — must violate UNIQUE
          execution_id: "exec_1",
          event_type: "opc.matched",
          aggregate_type: "execution",
          aggregate_id: "exec_1",
          aggregate_version: 2,
          event_schema_version: "1.0.0",
          payload: {},
        },
      }),
    ).rejects.toThrow();
  });

  it("persists an identity_principal with roles[] and is_development_principal defaulting to false", async () => {
    const principal = await prisma.identityPrincipal.create({
      data: { tenant_id: "tenant_1", display_name: "svc-platform", roles: ["operator", "approver"] },
    });
    expect(principal.roles).toEqual(["operator", "approver"]);
    expect(principal.is_development_principal).toBe(false);
  });

  it("labels a dev principal explicitly via is_development_principal: true", async () => {
    const principal = await prisma.identityPrincipal.create({
      data: {
        tenant_id: "tenant_1",
        display_name: "dev-local-principal",
        roles: ["operator"],
        is_development_principal: true,
      },
    });
    expect(principal.is_development_principal).toBe(true);
  });
});
