import { describe, expect, it } from "vitest";
import type { OPCMatchResult } from "@aop/contracts";
import { InMemoryOpcMatchEvidenceSink } from "./opc-match-evidence-sink.js";

const result: OPCMatchResult = {
  request_id: "req_1",
  candidates: [{ opc_id: "opc_1", opc_version: "1.0.0", match_score: 1 }],
  selected_opc_id: "opc_1",
  minimum_required_margin: 0.15,
  outcome: "MATCHED",
};

describe("InMemoryOpcMatchEvidenceSink", () => {
  it("records a result and returns it via recordsFor()", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    await sink.record("tenant_1", result);
    expect(sink.recordsFor("tenant_1")).toEqual([result]);
  });

  it("returns an empty array for a tenant with no recorded results", () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    expect(sink.recordsFor("tenant_never_used")).toEqual([]);
  });

  it("keeps records scoped per tenant_id", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    await sink.record("tenant_1", result);
    expect(sink.recordsFor("tenant_2")).toEqual([]);
  });

  it("accumulates multiple records for the same tenant in order", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    const second: OPCMatchResult = { ...result, request_id: "req_2" };
    await sink.record("tenant_1", result);
    await sink.record("tenant_1", second);
    expect(sink.recordsFor("tenant_1")).toEqual([result, second]);
  });
});
