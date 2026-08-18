import { describe, expect, it } from "vitest";
import type { Evidence } from "@aop/contracts";
import { InMemoryEvidenceRecorder } from "./evidence-recorder.js";

const evidence: Evidence = {
  evidence_id: "ev_1",
  tenant_id: "tenant_1",
  request_id: "req_1",
  execution_id: "exec_1",
  type: "REQUEST",
  source: { component: "test" },
  content: { summary: "test evidence" },
  relationships: {},
  integrity: { created_at: "2026-08-18T00:00:00.000Z", content_hash: "sha256:x" },
  retention_class: "operational_state",
  retention_expires_at: "2026-09-18T00:00:00.000Z",
  retention_policy_version: "v0-dev-default",
  legal_hold: false,
};

describe("InMemoryEvidenceRecorder", () => {
  it("records and returns evidence via evidenceFor()", async () => {
    const recorder = new InMemoryEvidenceRecorder();
    await recorder.record(evidence);
    expect(recorder.evidenceFor("exec_1")).toEqual([evidence]);
  });

  it("returns an empty array for an execution with no recorded evidence", () => {
    const recorder = new InMemoryEvidenceRecorder();
    expect(recorder.evidenceFor("exec_never_used")).toEqual([]);
  });

  it("accumulates multiple evidence records for the same execution in order", async () => {
    const recorder = new InMemoryEvidenceRecorder();
    const second: Evidence = { ...evidence, evidence_id: "ev_2", type: "OBSERVATION" };
    await recorder.record(evidence);
    await recorder.record(second);
    expect(recorder.evidenceFor("exec_1")).toEqual([evidence, second]);
  });
});
