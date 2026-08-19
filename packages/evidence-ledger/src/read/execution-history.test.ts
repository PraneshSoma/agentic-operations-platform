import { describe, expect, it } from "vitest";
import type { Evidence } from "@aop/contracts";
import { buildExecutionHistory } from "./execution-history.js";

function ev(evidenceId: string, createdAt: string, overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidence_id: evidenceId,
    tenant_id: "tenant_1",
    request_id: "req_1",
    execution_id: "exec_1",
    type: "OUTCOME",
    source: { component: "orchestrator.state_machine" },
    content: { summary: `event ${evidenceId}` },
    relationships: {},
    integrity: { created_at: createdAt, content_hash: "sha256:x" },
    retention_class: "operational_state",
    retention_expires_at: createdAt,
    retention_policy_version: "dev-nonprod-v0",
    legal_hold: false,
    ...overrides,
  };
}

describe("buildExecutionHistory() — reconstruct from evidence records alone (E-05, F-16)", () => {
  it("CRITICAL: reconstructs the complete ordered timeline from evidence records only, no other input", () => {
    const history = buildExecutionHistory("tenant_1", "exec_1", [
      ev("ev_3", "2026-08-18T12:02:00.000Z", { type: "ACTION_RESULT", content: { summary: "executed" } }),
      ev("ev_1", "2026-08-18T12:00:00.000Z", { type: "REQUEST", content: { summary: "received" } }),
      ev("ev_2", "2026-08-18T12:01:00.000Z", { type: "PLAN", content: { summary: "planned" } }),
    ]);

    expect(history.entries.map((e) => e.evidence_id)).toEqual(["ev_1", "ev_2", "ev_3"]);
    expect(history.entries.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(history.entries.map((e) => e.summary)).toEqual(["received", "planned", "executed"]);
    expect(history.entries.map((e) => e.evidence_type)).toEqual(["REQUEST", "PLAN", "ACTION_RESULT"]);
  });

  it("breaks created_at ties deterministically by evidence_id, so reconstruction is reproducible", () => {
    const t = "2026-08-18T12:00:00.000Z";
    const a = buildExecutionHistory("tenant_1", "exec_1", [ev("ev_b", t), ev("ev_a", t)]);
    const b = buildExecutionHistory("tenant_1", "exec_1", [ev("ev_a", t), ev("ev_b", t)]);
    expect(a.entries.map((e) => e.evidence_id)).toEqual(["ev_a", "ev_b"]);
    expect(a).toEqual(b); // order-independent input, identical output
  });

  it("surfaces relationships.supersedes on a correcting record (append-only ledger, F-15)", () => {
    const history = buildExecutionHistory("tenant_1", "exec_1", [
      ev("ev_1", "2026-08-18T12:00:00.000Z"),
      ev("ev_2", "2026-08-18T12:01:00.000Z", { relationships: { supersedes: "ev_1" } }),
    ]);
    expect(history.entries[0]?.supersedes).toBeUndefined();
    expect(history.entries[1]?.supersedes).toBe("ev_1");
  });

  it("returns an empty timeline for an execution with no evidence yet", () => {
    const history = buildExecutionHistory("tenant_1", "exec_1", []);
    expect(history).toEqual({ tenant_id: "tenant_1", execution_id: "exec_1", entries: [] });
  });

  it("does not mutate the input array", () => {
    const input = [ev("ev_2", "2026-08-18T12:01:00.000Z"), ev("ev_1", "2026-08-18T12:00:00.000Z")];
    const snapshot = input.map((e) => e.evidence_id);
    buildExecutionHistory("tenant_1", "exec_1", input);
    expect(input.map((e) => e.evidence_id)).toEqual(snapshot);
  });
});
