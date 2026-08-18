import { describe, expect, it } from "vitest";
import type { IncomingRequest, OperationalProcedureContract } from "@aop/contracts";
import { matchOpc } from "./opc-matcher.js";
import type { SemanticMatcher } from "./semantic-matcher.js";
import { InMemoryOpcMatchEvidenceSink } from "./opc-match-evidence-sink.js";

function request(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    request_id: "req_1",
    tenant_id: "tenant_1",
    source: { type: "webhook", source_id: "s", source_reference: "r" },
    received_at: "2026-08-18T00:00:00.000Z",
    requester: { id: "u1", roles: [] },
    subject: "Checkout service error rate spike",
    description: "Errors climbing on checkout-service since deploy",
    labels: { category: "error-spike", application: "checkout-service", severity: "P1" },
    raw_payload_ref: "ref_1",
    correlation: {},
    ...overrides,
  };
}

function opc(overrides: Partial<OperationalProcedureContract> = {}): OperationalProcedureContract {
  return {
    opc_id: "opc_1",
    version: "1.0.0",
    tenant_id: "tenant_1",
    name: "Production Error Spike",
    status: "published",
    match: { categories: ["error-spike"], applications: ["checkout-service"], severities: ["P1"] },
    required_context: [],
    investigation: { objective: "isolate", required_checks: [], max_hypotheses: 3 },
    actions: { allowed_action_refs: [] },
    verification: { checks: [] },
    escalation: { conditions: [] },
    rollback: { required_for_risk_levels: [] },
    timeout: { investigation_minutes: 10, approval_minutes: 10, execution_minutes: 10 },
    budget: {
      max_investigation_tokens: 1,
      max_planning_tokens: 1,
      max_tool_calls: 1,
      max_wall_clock_minutes: 1,
      on_exceeded: "ESCALATE",
    },
    ...overrides,
  };
}

/** Deterministic stub matcher — returns whatever score the test fixed for each opc_id. */
function stubMatcher(scores: Record<string, number>): SemanticMatcher {
  return { score: (_req, o) => scores[o.opc_id] ?? 0 };
}

describe("matchOpc — spec §6 exact filter + §6A margin guardrail", () => {
  it("MATCHED with a single exact-filter survivor — no semantic matcher needed, no match_margin", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    let semanticMatcherCalled = false;
    const result = await matchOpc(request(), [opc()], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: { score: () => ((semanticMatcherCalled = true), 1) },
      evidenceSink: sink,
    });

    expect(result.outcome).toBe("MATCHED");
    expect(result.selected_opc_id).toBe("opc_1");
    expect(result.match_margin).toBeUndefined();
    expect(semanticMatcherCalled).toBe(false);
  });

  it("AMBIGUOUS_ESCALATE with zero exact-filter survivors — never invents an OPC (spec §6)", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    const mismatched = opc({ match: { categories: ["billing"], applications: ["billing-service"], severities: ["P4"] } });
    const result = await matchOpc(request(), [mismatched], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: stubMatcher({}),
      evidenceSink: sink,
    });

    expect(result.outcome).toBe("AMBIGUOUS_ESCALATE");
    expect(result.selected_opc_id).toBeUndefined();
    expect(result.candidates).toEqual([]);
  });

  it("MATCHED via semantic fallback when margin clears the threshold (F-02 MVP)", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    const opcA = opc({ opc_id: "opc_a" });
    const opcB = opc({ opc_id: "opc_b" });
    const result = await matchOpc(request(), [opcA, opcB], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: stubMatcher({ opc_a: 0.9, opc_b: 0.5 }),
      evidenceSink: sink,
    });

    expect(result.outcome).toBe("MATCHED");
    expect(result.selected_opc_id).toBe("opc_a");
    expect(result.match_margin).toBeCloseTo(0.4);
    expect(result.candidates).toHaveLength(2);
  });

  it("CRITICAL: AMBIGUOUS_ESCALATE (never an auto-pick) when the margin is below minimum_required_margin", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    const opcA = opc({ opc_id: "opc_a" });
    const opcB = opc({ opc_id: "opc_b" });
    const result = await matchOpc(request(), [opcA, opcB], {
      minimumRequiredMargin: 0.15,
      // Margin here is 0.04 — deliberately below the 0.15 threshold.
      semanticMatcher: stubMatcher({ opc_a: 0.62, opc_b: 0.58 }),
      evidenceSink: sink,
    });

    expect(result.outcome).toBe("AMBIGUOUS_ESCALATE");
    expect(result.selected_opc_id).toBeUndefined();
    expect(result.match_margin).toBeCloseTo(0.04);
    // Both candidates are still recorded, scored, sorted — just not picked.
    expect(result.candidates.map((c) => c.opc_id)).toEqual(["opc_a", "opc_b"]);
  });

  it("a margin exactly equal to minimum_required_margin is MATCHED (>=, not strictly >)", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    const opcA = opc({ opc_id: "opc_a" });
    const opcB = opc({ opc_id: "opc_b" });
    const result = await matchOpc(request(), [opcA, opcB], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: stubMatcher({ opc_a: 0.65, opc_b: 0.5 }),
      evidenceSink: sink,
    });
    expect(result.outcome).toBe("MATCHED");
  });

  it("excludes non-published and cross-tenant OPCs from the exact filter", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    const draft = opc({ opc_id: "opc_draft", status: "draft" });
    const otherTenant = opc({ opc_id: "opc_other_tenant", tenant_id: "tenant_2" });
    const result = await matchOpc(request(), [draft, otherTenant], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: stubMatcher({}),
      evidenceSink: sink,
    });
    expect(result.outcome).toBe("AMBIGUOUS_ESCALATE");
    expect(result.candidates).toEqual([]);
  });

  it("a request label absent from the OPC's declared match set excludes that OPC (application)", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    const wrongApp = opc({ match: { categories: ["error-spike"], applications: ["other-service"], severities: ["P1"] } });
    const result = await matchOpc(request(), [wrongApp], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: stubMatcher({}),
      evidenceSink: sink,
    });
    expect(result.outcome).toBe("AMBIGUOUS_ESCALATE");
  });

  it("a request label absent from the OPC's declared match set excludes that OPC (severity)", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    const wrongSeverity = opc({
      match: { categories: ["error-spike"], applications: ["checkout-service"], severities: ["P4"] },
    });
    const result = await matchOpc(request(), [wrongSeverity], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: stubMatcher({}),
      evidenceSink: sink,
    });
    expect(result.outcome).toBe("AMBIGUOUS_ESCALATE");
  });

  it("SPEC §6A: OPCMatchResult (all candidates) is written to the evidence sink unconditionally, on every outcome", async () => {
    const sink = new InMemoryOpcMatchEvidenceSink();
    await matchOpc(request(), [opc()], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: stubMatcher({}),
      evidenceSink: sink,
    }); // MATCHED path
    await matchOpc(request({ request_id: "req_2" }), [], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: stubMatcher({}),
      evidenceSink: sink,
    }); // AMBIGUOUS_ESCALATE path (no candidates at all)

    const recorded = sink.recordsFor("tenant_1");
    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.outcome).toBe("MATCHED");
    expect(recorded[1]?.outcome).toBe("AMBIGUOUS_ESCALATE");
  });
});
