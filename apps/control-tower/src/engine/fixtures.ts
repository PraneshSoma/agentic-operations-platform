/**
 * Demo fixtures for the interactive engine — the same governed scenario the
 * narrated CLI demo (apps/demo) uses, factored into reusable factories so
 * the live engine can drive the REAL @aop pipeline packages in-process. Not
 * unit-tested on its own (excluded with the rest of engine/**): it is demo
 * presentation data, verified by running the demo, exactly like apps/demo.
 */
import type {
  ActionDefinition,
  ConnectorDescriptor,
  IncomingRequest,
  OperationalProcedureContract,
  ProposedAction,
} from "@aop/contracts";
import { SimulatedFixtureConnector } from "@aop/context-service";
import { LocalDevIdentityResolver } from "@aop/identity";
import { EnvVarSecretResolver } from "@aop/secrets";
import { SimulatedLLMProvider } from "@aop/worker";

export const TENANT = "acme-corp";
export const NOW = new Date("2026-08-19T12:00:00.000Z");
export const PROPOSER = "sam-oncall";
export const APPROVER = "riley-lead";
export const PROPOSER_DISPLAY = "Sam — On-Call Engineer";
export const APPROVER_DISPLAY = "Riley — Senior On-Call Lead";

/** Human-friendly label for demo surfaces; principal IDs remain stable for authorization and audit. */
export function principalDisplayName(principalId: string): string {
  if (principalId === PROPOSER) return PROPOSER_DISPLAY;
  if (principalId === APPROVER) return APPROVER_DISPLAY;
  return principalId;
}

export const secretResolver = new EnvVarSecretResolver({ SIM_APP_KEY: "sk-demo", SIM_ACTION_KEY: "sk-demo" });

export function incident(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    request_id: "INC-4417",
    tenant_id: TENANT,
    source: { type: "webhook", source_id: "pagerduty", source_reference: "PD-91" },
    received_at: NOW.toISOString(),
    requester: { id: PROPOSER, roles: ["operator"] },
    subject: "Checkout error rate spike",
    description: "Error rate elevated on checkout-service since the last deploy",
    labels: { category: "error-spike", application: "checkout-service", severity: "P1" },
    raw_payload_ref: "raw_ref_1",
    correlation: { incident_id: "INC-4417" },
    ...overrides,
  };
}

export function errorSpikeOpc(overrides: Partial<OperationalProcedureContract> = {}): OperationalProcedureContract {
  return {
    opc_id: "opc_error_spike",
    version: "1.0.0",
    tenant_id: TENANT,
    name: "Production Error Spike",
    status: "published",
    match: { categories: ["error-spike"], applications: ["checkout-service"], severities: ["P1"] },
    required_context: [
      { context_type: "application", connector_ref: "sim-app", operation: "get_state", required: true, timeout_ms: 5000 },
      { context_type: "runtime", connector_ref: "sim-runtime", operation: "query_logs", required: true, timeout_ms: 5000 },
    ],
    investigation: { objective: "isolate the failing service and pick a registered remediation", required_checks: ["query_logs"], max_hypotheses: 3 },
    actions: { allowed_action_refs: ["restart_service"] },
    verification: { checks: [] },
    escalation: { conditions: [] },
    rollback: { required_for_risk_levels: ["R2", "R3"] },
    timeout: { investigation_minutes: 10, approval_minutes: 15, execution_minutes: 5 },
    budget: { max_investigation_tokens: 10_000, max_planning_tokens: 5_000, max_tool_calls: 10, max_wall_clock_minutes: 30, on_exceeded: "ESCALATE" },
    ...overrides,
  };
}

export const appConnectorDescriptor: ConnectorDescriptor = {
  connector_id: "sim-app",
  tenant_id: TENANT,
  type: "api",
  operations: [{ name: "get_state", input_schema: {}, output_schema: {} }],
  authorization: { mode: "api_key", secret_ref: "secret://SIM_APP_KEY" },
  scopes: { environments: ["prod"], applications: ["checkout-service"] },
  staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" },
  definition_version: "1.0.0",
  supports_correlation: false,
  is_idempotent: false,
  reliability_level: "HIGH",
};

export const runtimeConnectorDescriptor: ConnectorDescriptor = {
  ...appConnectorDescriptor,
  connector_id: "sim-runtime",
  operations: [{ name: "query_logs", input_schema: {}, output_schema: {} }],
  reliability_level: "MEDIUM",
};

export const actionConnectorDescriptor: ConnectorDescriptor = {
  ...appConnectorDescriptor,
  connector_id: "sim-action-connector",
  operations: [{ name: "restart", input_schema: {}, output_schema: {} }],
  authorization: { mode: "api_key", secret_ref: "secret://SIM_ACTION_KEY" },
  reliability_level: "MEDIUM",
};

export const restartAction: ActionDefinition = {
  action_id: "restart_service",
  version: "1.0.0",
  tenant_id: TENANT,
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

export function appConnector(): SimulatedFixtureConnector {
  return new SimulatedFixtureConnector(
    appConnectorDescriptor,
    new Map([["default", {
      data: {
        application_id: "checkout-service", name: "Checkout Service", owners: ["team-checkout"], environments: ["prod"],
        dependencies: { upstream: [], downstream: [] }, apis: [], datastores: [], messaging: [], slo_refs: [], approved_action_refs: ["restart_service"], change_context: {},
      },
      retrievedAt: NOW,
    }]]),
    secretResolver,
  );
}

export function runtimeConnector(): SimulatedFixtureConnector {
  return new SimulatedFixtureConnector(
    runtimeConnectorDescriptor,
    new Map([["default", {
      data: {
        time_window: { from: NOW.toISOString(), to: NOW.toISOString() },
        logs: { summaries: ["error rate 5x baseline since the 11:40Z deploy"], evidence_refs: ["ev-log-1"] },
        metrics: [{ metric: "error_rate", current: 0.05, baseline: 0.01, anomaly: true }],
        traces: { summaries: [] },
        deployment_state: { version: "1.3.0", deployed_at: NOW.toISOString() },
      },
      retrievedAt: NOW,
    }]]),
    secretResolver,
  );
}

export function demoRegistry(): Map<string, SimulatedFixtureConnector> {
  return new Map([["sim-app", appConnector()], ["sim-runtime", runtimeConnector()]]);
}

export function investigationProvider(): SimulatedLLMProvider {
  return new SimulatedLLMProvider(JSON.stringify({
    observations: [{ id: "obs_1", statement: "error rate 5x baseline right after the deploy", evidence_ids: ["ev-log-1"] }],
    hypotheses: [{ id: "hyp_1", description: "recent deploy introduced a regression", supporting_evidence_ids: ["ev-log-1"], contradicting_evidence_ids: [], status: "supported" }],
    diagnosis: { summary: "deploy-induced error spike on checkout-service", evidence_ids: ["ev-log-1"] },
    missing_information: [],
    recommended_next_step: "PLAN",
  }));
}

export function planningProvider(version = "1.3.0"): SimulatedLLMProvider {
  return new SimulatedLLMProvider(JSON.stringify({
    plan_id: "plan_1", diagnosis_ref: "diag_1",
    steps: [{ step_id: "step_1", type: "ACTION", description: "restart checkout-service", action_ref: "restart_service", parameters: { version } }],
    expected_outcome: "error rate returns to baseline", unresolved_risks: [],
  }));
}

export function proposedAction(): ProposedAction {
  return {
    proposal_id: "prop_1", request_id: "INC-4417", execution_id: "exec_1", tenant_id: TENANT,
    action_ref: "restart_service", action_version: "1.0.0", reason: "deploy-induced error spike", parameters: { version: "1.3.0" },
    expected_outcome: "error rate returns to baseline",
    risk_assessment: { requested_risk_class: "R2", blast_radius: { scope: "service" }, reversible: true },
    supporting_evidence_ids: [], generated_by: { agent: "planner", model: "sim-llm", prompt_version: "1" }, accountable_principal_id: PROPOSER, created_at: NOW.toISOString(),
  };
}

export function identityResolver(): LocalDevIdentityResolver {
  return new LocalDevIdentityResolver([
    { id: PROPOSER, tenant_id: TENANT, display_name: PROPOSER_DISPLAY, roles: ["operator"] },
    { id: APPROVER, tenant_id: TENANT, display_name: APPROVER_DISPLAY, roles: ["senior_oncall"] },
  ]);
}
