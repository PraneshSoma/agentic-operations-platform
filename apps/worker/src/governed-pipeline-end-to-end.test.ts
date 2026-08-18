import { describe, expect, it } from "vitest";
import type { ActionDefinition, ConnectorDescriptor, IncomingRequest, OperationalProcedureContract } from "@aop/contracts";
import { matchOpc, InMemoryOpcMatchEvidenceSink, TextOverlapSemanticMatcher, evaluatePolicy, runApprovalAcceptanceGate } from "@aop/policy-engine";
import { assembleContextPackage, SimulatedFixtureConnector } from "@aop/context-service";
import { LocalDevIdentityResolver } from "@aop/identity";
import { EnvVarSecretResolver } from "@aop/secrets";
import { assertMatchesFrozenPlan, SimulatedActionConnector } from "@aop/action-executor";
import { runInvestigation } from "./agents/investigator.js";
import { runPlanning } from "./agents/planner.js";
import { SimulatedLLMProvider } from "./agents/simulated-llm-provider.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");

/**
 * End-to-end integration test — story D-01's second acceptance
 * criterion: "Proves the complete governed pipeline end-to-end without
 * a real production mutation." Chains every governed stage built so far
 * against one coherent scenario, using only simulated/in-memory
 * implementations — no real network call, no real secret manager, no
 * real production system touched anywhere:
 *
 * IncomingRequest -> OPC match -> context assembly -> investigation ->
 * planning -> policy evaluation (REQUIRE_APPROVAL) -> Approval
 * Acceptance Gate (ExecutionAuthorization) -> Frozen Plan Rule check ->
 * preflight -> execute (against SimulatedActionConnector's in-memory
 * "target").
 */
describe("Governed pipeline — end to end (D-01, real production mutation never occurs)", () => {
  it("carries one incident from trigger through an authorized, executed action against only a simulated target", async () => {
    const tenantId = "tenant_1";

    // 1. Normalized trigger (equivalent to what B-01's webhook adapter produces).
    const incomingRequest: IncomingRequest = {
      request_id: "req_1",
      tenant_id: tenantId,
      source: { type: "webhook", source_id: "pagerduty", source_reference: "PD-1" },
      received_at: NOW.toISOString(),
      requester: { id: "user_proposer", roles: ["operator"] },
      subject: "Checkout service error rate spike",
      description: "Error rate elevated on checkout-service since the last deploy",
      labels: { category: "error-spike", application: "checkout-service", severity: "P1" },
      raw_payload_ref: "raw_ref_1",
      correlation: { incident_id: "INC-1" },
    };

    // 2. OPC match (B-02).
    const opc: OperationalProcedureContract = {
      opc_id: "opc_error_spike",
      version: "1.0.0",
      tenant_id: tenantId,
      name: "Production Error Spike",
      status: "published",
      match: { categories: ["error-spike"], applications: ["checkout-service"], severities: ["P1"] },
      required_context: [
        { context_type: "application", connector_ref: "sim-app", operation: "get_state", required: true, timeout_ms: 5000 },
      ],
      investigation: { objective: "isolate the failing service and select a registered remediation", required_checks: ["query_logs"], max_hypotheses: 3 },
      actions: { allowed_action_refs: ["restart_service"] },
      verification: { checks: [] },
      escalation: { conditions: [] },
      rollback: { required_for_risk_levels: ["R2", "R3"] },
      timeout: { investigation_minutes: 10, approval_minutes: 15, execution_minutes: 5 },
      budget: { max_investigation_tokens: 10_000, max_planning_tokens: 5_000, max_tool_calls: 10, max_wall_clock_minutes: 30, on_exceeded: "ESCALATE" },
    };

    const matchResult = await matchOpc(incomingRequest, [opc], {
      minimumRequiredMargin: 0.15,
      semanticMatcher: new TextOverlapSemanticMatcher(),
      evidenceSink: new InMemoryOpcMatchEvidenceSink(),
    });
    expect(matchResult.outcome).toBe("MATCHED");
    expect(matchResult.selected_opc_id).toBe("opc_error_spike");

    // 3. Context assembly (B-04), via a simulated read connector.
    const secretResolver = new EnvVarSecretResolver({ SIM_APP_KEY: "sk-fixture-secret" });
    const appConnectorDescriptor: ConnectorDescriptor = {
      connector_id: "sim-app",
      tenant_id: tenantId,
      type: "api",
      operations: [{ name: "get_state", input_schema: {}, output_schema: {} }],
      authorization: { mode: "api_key", secret_ref: "secret://SIM_APP_KEY" },
      scopes: { environments: ["prod"], applications: ["checkout-service"] },
      staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" },
      definition_version: "1.0.0",
      supports_correlation: false,
      is_idempotent: false,
      reliability_level: "MEDIUM",
    };
    const appConnector = new SimulatedFixtureConnector(
      appConnectorDescriptor,
      new Map([
        [
          "default",
          {
            data: {
              application_id: "checkout-service",
              name: "Checkout Service",
              owners: ["team-checkout"],
              environments: ["prod"],
              dependencies: { upstream: [], downstream: [] },
              apis: [],
              datastores: [],
              messaging: [],
              slo_refs: [],
              approved_action_refs: ["restart_service"],
              change_context: {},
            },
            retrievedAt: NOW,
          },
        ],
      ]),
      secretResolver,
    );

    const contextPackage = await assembleContextPackage({
      tenantId,
      requestId: incomingRequest.request_id,
      executionId: "exec_1",
      opcId: opc.opc_id,
      requiredContext: opc.required_context,
      connectorRegistry: new Map([["sim-app", appConnector]]),
      now: NOW,
    });
    expect(contextPackage.missing_context).toEqual([]);

    // 4. Investigation (B-05).
    const investigationProvider = new SimulatedLLMProvider(
      JSON.stringify({
        observations: [{ id: "obs_1", statement: "checkout-service application context confirms recent deploy risk", evidence_ids: [] }],
        hypotheses: [
          { id: "hyp_1", description: "recent deploy introduced a regression", supporting_evidence_ids: [], contradicting_evidence_ids: [], status: "supported" },
        ],
        diagnosis: { summary: "deploy-induced error spike on checkout-service", evidence_ids: [] },
        missing_information: [],
        recommended_next_step: "PLAN",
      }),
    );
    const investigation = await runInvestigation({ incomingRequest, opc, contextPackage, llmProvider: investigationProvider });
    expect(investigation.recommended_next_step).toBe("PLAN");

    // 5. Planning (B-06) — proposes exactly one ACTION step against a registered action.
    const restartAction: ActionDefinition = {
      action_id: "restart_service",
      version: "1.0.0",
      tenant_id: tenantId,
      name: "Restart Service",
      description: "Restarts a service instance",
      executor_connector_ref: "sim-action-connector",
      operation: "restart",
      input_schema: {},
      default_risk_class: "R2",
      blast_radius: { scope: "service" },
      reversible: true,
      environment_constraints: { allowed: ["prod"] },
      policy_tags: [],
      status: "active",
      compensation_class: "REVERSIBLE",
    };
    const planningProvider = new SimulatedLLMProvider(
      JSON.stringify({
        plan_id: "plan_1",
        diagnosis_ref: "diag_1",
        steps: [
          { step_id: "step_1", type: "ACTION", description: "restart checkout-service", action_ref: "restart_service", parameters: { version: "1.3.0" } },
        ],
        expected_outcome: "error rate returns to baseline",
        unresolved_risks: [],
      }),
    );
    const plan = await runPlanning({ investigation, opc, availableActions: [restartAction], llmProvider: planningProvider });
    expect(plan.steps).toHaveLength(1);

    // 6. Policy evaluation (C-03) — R2 in prod requires approval.
    const proposedAction = {
      proposal_id: "prop_1",
      request_id: incomingRequest.request_id,
      execution_id: "exec_1",
      tenant_id: tenantId,
      action_ref: "restart_service",
      action_version: "1.0.0",
      reason: investigation.diagnosis.summary,
      parameters: { version: "1.3.0" },
      expected_outcome: plan.expected_outcome,
      risk_assessment: { requested_risk_class: "R2" as const, blast_radius: { scope: "service" }, reversible: true },
      supporting_evidence_ids: [],
      generated_by: { agent: "planner", model: "simulated-llm-provider", prompt_version: "1" },
      accountable_principal_id: "user_proposer",
      created_at: NOW.toISOString(),
    };
    const policyDecision = evaluatePolicy({
      decisionId: "dec_1",
      createdAt: NOW.toISOString(),
      proposedAction,
      environment: "prod",
      actionDefinition: restartAction,
      missingRequiredEvidence: false,
      killSwitchActive: false,
      policyRules: [{ rule_id: "prod_r2_approval", when: { environment: "prod", risk_class_in: ["R2", "R3"] }, decision: "REQUIRE_APPROVAL", approval_route: "senior_oncall" }],
      policyVersion: "v1",
      evidenceSummary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 },
      now: NOW,
    });
    expect(policyDecision.outcome).toBe("REQUIRE_APPROVAL");

    // 7. Approval Acceptance Gate (C-04) — a different principal approves.
    const identityResolver = new LocalDevIdentityResolver([
      { id: "user_proposer", tenant_id: tenantId, display_name: "Proposer", roles: ["operator"] },
      { id: "user_approver", tenant_id: tenantId, display_name: "Approver", roles: ["senior_oncall"] },
    ]);
    const gateResult = await runApprovalAcceptanceGate({
      tenantId,
      policyDecision,
      proposedAction,
      decision: "APPROVED",
      actorId: "user_approver",
      identityResolver,
      now: NOW,
      authorizationId: "auth_1",
      signedPlanHash: "sha256:plan-hash",
      issuedBy: "approval-acceptance-gate",
    });
    expect(gateResult.outcome).toBe("AUTHORIZED");
    if (gateResult.outcome !== "AUTHORIZED") return; // narrows the type for the rest of the test

    // 8. Frozen Plan Rule (B-06) — the executor may only run exactly the approved step.
    expect(() =>
      assertMatchesFrozenPlan(plan, { step_id: "step_1", action_ref: "restart_service", parameters: { version: "1.3.0" } }),
    ).not.toThrow();

    // 9 & 10. Preflight + execute against a SIMULATED target — no real production mutation occurs anywhere.
    const actionConnectorDescriptor: ConnectorDescriptor = {
      connector_id: "sim-action-connector",
      tenant_id: tenantId,
      type: "api",
      operations: [{ name: "restart", input_schema: {}, output_schema: {} }],
      authorization: { mode: "api_key", secret_ref: "secret://SIM_ACTION_KEY" },
      scopes: { environments: ["prod"], applications: ["checkout-service"] },
      staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" },
      definition_version: "1.0.0",
      supports_correlation: false,
      is_idempotent: false,
      reliability_level: "MEDIUM",
    };
    const actionSecretResolver = new EnvVarSecretResolver({ SIM_ACTION_KEY: "sk-fixture-secret" });
    const actionConnector = new SimulatedActionConnector(
      actionConnectorDescriptor,
      actionSecretResolver,
      new Map([["version", "1.2.3"]]), // the simulated target's starting state
      () => NOW,
    );

    const preflightResult = await actionConnector.preflight(restartAction, { version: "1.3.0" }, {
      checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }],
    });
    expect(preflightResult.status).toBe("MATCH");

    const executionResult = await actionConnector.execute(restartAction, { version: "1.3.0" }, gateResult.authorization, "op_test_e2e");
    expect(executionResult.status).toBe("SUCCESS");
    expect(executionResult.proposal_id).toBe("prop_1");
    // The ONLY thing that changed is the connector's own in-memory map —
    // never anything outside this test process.
    expect(actionConnector.getTargetState("version")).toBe("1.3.0");
  });
});
