import { describe, expect, it } from "vitest";
import type { ContextPackage, IncomingRequest, OperationalProcedureContract } from "@aop/contracts";
import { InventedEvidenceError, runInvestigation } from "./investigator.js";
import { SimulatedLLMProvider } from "./simulated-llm-provider.js";

const incomingRequest: IncomingRequest = {
  request_id: "req_1",
  tenant_id: "tenant_1",
  source: { type: "webhook", source_id: "s", source_reference: "r" },
  received_at: "2026-08-18T00:00:00.000Z",
  requester: { id: "u1", roles: [] },
  subject: "Checkout error rate spike",
  description: "Errors climbing since deploy",
  labels: {},
  raw_payload_ref: "ref_1",
  correlation: {},
};

const opc: OperationalProcedureContract = {
  opc_id: "opc_1",
  version: "1.0.0",
  tenant_id: "tenant_1",
  name: "Production Error Spike",
  status: "published",
  match: { categories: [], applications: [], severities: [] },
  required_context: [],
  investigation: { objective: "isolate the failing service", required_checks: ["query_logs"], max_hypotheses: 3 },
  actions: { allowed_action_refs: [] },
  verification: { checks: [] },
  escalation: { conditions: [] },
  rollback: { required_for_risk_levels: [] },
  timeout: { investigation_minutes: 10, approval_minutes: 10, execution_minutes: 10 },
  budget: { max_investigation_tokens: 1000, max_planning_tokens: 1000, max_tool_calls: 10, max_wall_clock_minutes: 10, on_exceeded: "ESCALATE" },
};

function contextPackage(evidenceRefs: string[]): ContextPackage {
  return {
    context_package_id: "ctx_1",
    tenant_id: "tenant_1",
    request_id: "req_1",
    opc_id: "opc_1",
    assembled_at: "2026-08-18T00:00:00.000Z",
    application_context: {
      application_id: "checkout-service",
      name: "Checkout Service",
      owners: [],
      environments: [],
      dependencies: { upstream: [], downstream: [] },
      apis: [],
      datastores: [],
      messaging: [],
      slo_refs: [],
      approved_action_refs: [],
      change_context: {},
    },
    runtime_context: {
      time_window: { from: "2026-08-18T00:00:00.000Z", to: "2026-08-18T00:00:00.000Z" },
      logs: { summaries: ["error rate elevated"], evidence_refs: evidenceRefs },
      metrics: [],
      traces: { summaries: [] },
      deployment_state: {},
    },
    historical_evidence: { similar_cases: [], aggregate: { precedent_count: 0, verified_success_count: 0, failure_count: 0, rollback_count: 0 } },
    missing_context: [],
    stale_context: [],
    provenance: [],
  };
}

function validInvestigationResultJson(evidenceId: string): string {
  return JSON.stringify({
    observations: [{ id: "obs_1", statement: "error rate elevated", evidence_ids: [evidenceId] }],
    hypotheses: [
      {
        id: "hyp_1",
        description: "recent deploy caused a regression",
        supporting_evidence_ids: [evidenceId],
        contradicting_evidence_ids: [],
        status: "supported",
      },
    ],
    diagnosis: { summary: "deploy-induced error spike", evidence_ids: [evidenceId] },
    missing_information: [],
    recommended_next_step: "PLAN",
  });
}

describe("runInvestigation", () => {
  it("returns a schema-valid InvestigationResult when every evidence_id traces to the ContextPackage", async () => {
    const provider = new SimulatedLLMProvider(validInvestigationResultJson("ev_1"));
    const result = await runInvestigation({
      incomingRequest,
      opc,
      contextPackage: contextPackage(["ev_1"]),
      llmProvider: provider,
    });
    expect(result.recommended_next_step).toBe("PLAN");
    expect(result.hypotheses[0]?.status).toBe("supported");
  });

  it("CRITICAL: throws InventedEvidenceError when the response references an evidence_id not in the ContextPackage (F-05)", async () => {
    const provider = new SimulatedLLMProvider(validInvestigationResultJson("ev_invented"));
    await expect(
      runInvestigation({ incomingRequest, opc, contextPackage: contextPackage(["ev_1"]), llmProvider: provider }),
    ).rejects.toThrow(InventedEvidenceError);
  });

  it("InventedEvidenceError names exactly the invented evidence_id(s)", async () => {
    const provider = new SimulatedLLMProvider(validInvestigationResultJson("ev_invented"));
    try {
      await runInvestigation({ incomingRequest, opc, contextPackage: contextPackage(["ev_1"]), llmProvider: provider });
      expect.fail("expected InventedEvidenceError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InventedEvidenceError);
      expect((err as InventedEvidenceError).invented_evidence_ids).toEqual(["ev_invented"]);
    }
  });

  it("throws when the LLM response is not valid JSON", async () => {
    const provider = new SimulatedLLMProvider("not json at all");
    await expect(
      runInvestigation({ incomingRequest, opc, contextPackage: contextPackage([]), llmProvider: provider }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("throws when the LLM response is valid JSON but fails InvestigationResultSchema", async () => {
    const provider = new SimulatedLLMProvider(JSON.stringify({ not: "an investigation result" }));
    await expect(
      runInvestigation({ incomingRequest, opc, contextPackage: contextPackage([]), llmProvider: provider }),
    ).rejects.toThrow(/failed InvestigationResult validation/);
  });

  it("accepts a result with zero evidence_ids referenced when zero are needed (empty observations/hypotheses)", async () => {
    const provider = new SimulatedLLMProvider(
      JSON.stringify({
        observations: [],
        hypotheses: [],
        diagnosis: { summary: "insufficient data to diagnose", evidence_ids: [] },
        missing_information: ["logs unavailable"],
        recommended_next_step: "MORE_CONTEXT",
      }),
    );
    const result = await runInvestigation({ incomingRequest, opc, contextPackage: contextPackage([]), llmProvider: provider });
    expect(result.recommended_next_step).toBe("MORE_CONTEXT");
  });

  it("the system prompt lists every known evidence_id and forbids inventing beyond it", async () => {
    let capturedSystemPrompt = "";
    const provider = new SimulatedLLMProvider((input) => {
      capturedSystemPrompt = input.systemPrompt;
      return validInvestigationResultJson("ev_1");
    });
    await runInvestigation({ incomingRequest, opc, contextPackage: contextPackage(["ev_1", "ev_2"]), llmProvider: provider });
    expect(capturedSystemPrompt).toContain("ev_1");
    expect(capturedSystemPrompt).toContain("ev_2");
    expect(capturedSystemPrompt).toContain("never invent");
  });

  it("CRITICAL: also detects an invented evidence_id in contradicting_evidence_ids, not just supporting", async () => {
    const provider = new SimulatedLLMProvider(
      JSON.stringify({
        observations: [],
        hypotheses: [
          {
            id: "hyp_1",
            description: "unlikely cause",
            supporting_evidence_ids: [],
            contradicting_evidence_ids: ["ev_invented"],
            status: "rejected",
          },
        ],
        diagnosis: { summary: "x", evidence_ids: [] },
        missing_information: [],
        recommended_next_step: "PLAN",
      }),
    );
    await expect(
      runInvestigation({ incomingRequest, opc, contextPackage: contextPackage([]), llmProvider: provider }),
    ).rejects.toThrow(InventedEvidenceError);
  });

  it("the system prompt states \"(none declared)\" when the OPC has no required_checks", async () => {
    let capturedSystemPrompt = "";
    const provider = new SimulatedLLMProvider((input) => {
      capturedSystemPrompt = input.systemPrompt;
      return validInvestigationResultJson("ev_1");
    });
    const opcWithNoChecks = { ...opc, investigation: { ...opc.investigation, required_checks: [] } };
    await runInvestigation({ incomingRequest, opc: opcWithNoChecks, contextPackage: contextPackage(["ev_1"]), llmProvider: provider });
    expect(capturedSystemPrompt).toContain("(none declared)");
  });

  it("the system prompt states \"(none available)\" when the ContextPackage carries no evidence_refs", async () => {
    let capturedSystemPrompt = "";
    const provider = new SimulatedLLMProvider((input) => {
      capturedSystemPrompt = input.systemPrompt;
      return JSON.stringify({
        observations: [],
        hypotheses: [],
        diagnosis: { summary: "no evidence available", evidence_ids: [] },
        missing_information: ["no logs"],
        recommended_next_step: "MORE_CONTEXT",
      });
    });
    await runInvestigation({ incomingRequest, opc, contextPackage: contextPackage([]), llmProvider: provider });
    expect(capturedSystemPrompt).toContain("(none available)");
  });
});
