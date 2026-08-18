import { describe, expect, it } from "vitest";
import type { ActionDefinition, InvestigationResult, OperationalProcedureContract } from "@aop/contracts";
import { runPlanning, UnregisteredActionError } from "./planner.js";
import { SimulatedLLMProvider } from "./simulated-llm-provider.js";

const opc: OperationalProcedureContract = {
  opc_id: "opc_1",
  version: "1.0.0",
  tenant_id: "tenant_1",
  name: "Production Error Spike",
  status: "published",
  match: { categories: [], applications: [], severities: [] },
  required_context: [],
  investigation: { objective: "isolate", required_checks: [], max_hypotheses: 3 },
  actions: { allowed_action_refs: ["restart_service"] },
  verification: { checks: [] },
  escalation: { conditions: [] },
  rollback: { required_for_risk_levels: [] },
  timeout: { investigation_minutes: 10, approval_minutes: 10, execution_minutes: 10 },
  budget: { max_investigation_tokens: 1000, max_planning_tokens: 1000, max_tool_calls: 10, max_wall_clock_minutes: 10, on_exceeded: "ESCALATE" },
};

const restartServiceAction: ActionDefinition = {
  action_id: "restart_service",
  version: "1.0.0",
  tenant_id: "tenant_1",
  name: "Restart Service",
  description: "Restarts a service instance",
  executor_connector_ref: "k8s-connector",
  operation: "restart",
  input_schema: {},
  default_risk_class: "R1",
  blast_radius: { scope: "service" },
  reversible: true,
  environment_constraints: { allowed: ["prod"] },
  policy_tags: [],
  status: "active",
  compensation_class: "REVERSIBLE",
};

const investigation: InvestigationResult = {
  observations: [],
  hypotheses: [],
  diagnosis: { summary: "deploy-induced error spike", evidence_ids: [] },
  missing_information: [],
  recommended_next_step: "PLAN",
};

function planJson(actionRef: string): string {
  return JSON.stringify({
    plan_id: "plan_1",
    diagnosis_ref: "diag_1",
    steps: [
      { step_id: "step_1", type: "ACTION", description: "restart the service", action_ref: actionRef, parameters: { service: "checkout" } },
    ],
    expected_outcome: "error rate returns to baseline",
    unresolved_risks: [],
  });
}

describe("runPlanning", () => {
  it("returns a schema-valid ResolutionPlan when every ACTION step's action_ref is registered", async () => {
    const provider = new SimulatedLLMProvider(planJson("restart_service"));
    const plan = await runPlanning({ investigation, opc, availableActions: [restartServiceAction], llmProvider: provider });
    expect(plan.plan_id).toBe("plan_1");
    expect(plan.steps[0]?.action_ref).toBe("restart_service");
  });

  it("CRITICAL: throws UnregisteredActionError when a proposed ACTION step's action_ref isn't in availableActions", async () => {
    const provider = new SimulatedLLMProvider(planJson("delete_everything"));
    await expect(
      runPlanning({ investigation, opc, availableActions: [restartServiceAction], llmProvider: provider }),
    ).rejects.toThrow(UnregisteredActionError);
  });

  it("throws when the LLM response is not valid JSON", async () => {
    const provider = new SimulatedLLMProvider("not json");
    await expect(runPlanning({ investigation, opc, availableActions: [], llmProvider: provider })).rejects.toThrow(/not valid JSON/);
  });

  it("throws when the LLM response fails ResolutionPlanSchema validation", async () => {
    const provider = new SimulatedLLMProvider(JSON.stringify({ not: "a plan" }));
    await expect(runPlanning({ investigation, opc, availableActions: [], llmProvider: provider })).rejects.toThrow(
      /failed ResolutionPlan validation/,
    );
  });

  it("accepts a plan with only READ/VERIFY steps (no ACTION steps to check against the registry)", async () => {
    const provider = new SimulatedLLMProvider(
      JSON.stringify({
        plan_id: "plan_1",
        diagnosis_ref: "diag_1",
        steps: [{ step_id: "step_1", type: "READ", description: "confirm current state" }],
        expected_outcome: "confirmed",
        unresolved_risks: [],
      }),
    );
    const plan = await runPlanning({ investigation, opc, availableActions: [], llmProvider: provider });
    expect(plan.steps).toHaveLength(1);
  });

  it("the system prompt lists allowed_action_refs and available registered actions", async () => {
    let capturedSystemPrompt = "";
    const provider = new SimulatedLLMProvider((input) => {
      capturedSystemPrompt = input.systemPrompt;
      return planJson("restart_service");
    });
    await runPlanning({ investigation, opc, availableActions: [restartServiceAction], llmProvider: provider });
    expect(capturedSystemPrompt).toContain("restart_service");
  });

  it("the system prompt states \"(none declared)\"/\"(none available)\" when there are no allowed actions/registered actions", async () => {
    let capturedSystemPrompt = "";
    const provider = new SimulatedLLMProvider((input) => {
      capturedSystemPrompt = input.systemPrompt;
      return JSON.stringify({
        plan_id: "plan_1",
        diagnosis_ref: "diag_1",
        steps: [],
        expected_outcome: "n/a",
        unresolved_risks: [],
      });
    });
    const opcWithNoActions = { ...opc, actions: { allowed_action_refs: [] } };
    await runPlanning({ investigation, opc: opcWithNoActions, availableActions: [], llmProvider: provider });
    expect(capturedSystemPrompt).toContain("(none declared)");
    expect(capturedSystemPrompt).toContain("(none available)");
  });
});
