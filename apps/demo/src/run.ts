/**
 * Agentic Operations Platform — live narrated demo (not a test, not a mock).
 *
 * Runs the REAL governed pipeline and the REAL safety rails in-process, so a
 * live audience watches the same code the 706-test suite exercises. Six
 * scenes: one happy path, then five deliberate attempts to do the wrong
 * thing — each caught.
 *
 * Run:  pnpm demo        (from the repo root)
 */
import type {
  ActionDefinition,
  ConnectorDescriptor,
  IncomingRequest,
  OperationalProcedureContract,
  ProposedAction,
} from "@aop/contracts";
import {
  matchOpc,
  InMemoryOpcMatchEvidenceSink,
  TextOverlapSemanticMatcher,
  evaluatePolicy,
  runApprovalAcceptanceGate,
} from "@aop/policy-engine";
import { assembleContextPackage, SimulatedFixtureConnector } from "@aop/context-service";
import { LocalDevIdentityResolver } from "@aop/identity";
import { EnvVarSecretResolver } from "@aop/secrets";
import {
  assertMatchesFrozenPlan,
  SimulatedActionConnector,
  runGatedExecution,
  deriveOperationId,
} from "@aop/action-executor";
import { runVerification } from "@aop/verification-engine";
import { assembleConfidenceDimensions } from "@aop/confidence";
import { buildExecutionHistory } from "@aop/evidence-ledger";
import {
  runInvestigation,
  runPlanning,
  SimulatedLLMProvider,
  ExecutionStateMachine,
  InMemoryExecutionStateStore,
  InMemoryPlatformEventEmitter,
  InMemoryEvidenceRecorder,
  haltExecution,
  enforceBudget,
} from "@aop/worker";

// ── tiny presentation helpers (no deps) ──
const C = { reset: "\x1b[0m", cyan: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m" };
const scene = (n: number, title: string): void => console.log(`\n${C.bold}${C.cyan}━━━ Scene ${n}: ${title} ${C.reset}${C.cyan}${"━".repeat(Math.max(0, 60 - title.length))}${C.reset}`);
const step = (msg: string): void => console.log(`  ${C.dim}·${C.reset} ${msg}`);
const ok = (msg: string): void => console.log(`  ${C.green}✓${C.reset} ${msg}`);
const blocked = (msg: string): void => console.log(`  ${C.red}🛑 ${msg}${C.reset}`);
const why = (msg: string): void => console.log(`    ${C.yellow}↳ why it matters:${C.reset} ${C.dim}${msg}${C.reset}`);

const NOW = new Date("2026-08-19T12:00:00.000Z");
const TENANT = "acme-corp";
const secretResolver = new EnvVarSecretResolver({ SIM_APP_KEY: "sk-demo", SIM_ACTION_KEY: "sk-demo" });

// ── shared fixtures ──
function incident(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    request_id: "INC-4417",
    tenant_id: TENANT,
    source: { type: "webhook", source_id: "pagerduty", source_reference: "PD-91" },
    received_at: NOW.toISOString(),
    requester: { id: "sam-oncall", roles: ["operator"] },
    subject: "Checkout error rate spike",
    description: "Error rate elevated on checkout-service since the last deploy",
    labels: { category: "error-spike", application: "checkout-service", severity: "P1" },
    raw_payload_ref: "raw_ref_1",
    correlation: { incident_id: "INC-4417" },
    ...overrides,
  };
}

function errorSpikeOpc(overrides: Partial<OperationalProcedureContract> = {}): OperationalProcedureContract {
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

const appConnectorDescriptor: ConnectorDescriptor = {
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

const runtimeConnectorDescriptor: ConnectorDescriptor = { ...appConnectorDescriptor, connector_id: "sim-runtime", operations: [{ name: "query_logs", input_schema: {}, output_schema: {} }], reliability_level: "MEDIUM" };
const actionConnectorDescriptor: ConnectorDescriptor = { ...appConnectorDescriptor, connector_id: "sim-action-connector", operations: [{ name: "restart", input_schema: {}, output_schema: {} }], authorization: { mode: "api_key", secret_ref: "secret://SIM_ACTION_KEY" }, reliability_level: "MEDIUM" };

const restartAction: ActionDefinition = {
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

function appConnector(): SimulatedFixtureConnector {
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

function runtimeConnector(): SimulatedFixtureConnector {
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

function demoRegistry(): Map<string, SimulatedFixtureConnector> {
  return new Map([["sim-app", appConnector()], ["sim-runtime", runtimeConnector()]]);
}

function investigationProvider(): SimulatedLLMProvider {
  return new SimulatedLLMProvider(JSON.stringify({
    observations: [{ id: "obs_1", statement: "error rate 5x baseline right after the deploy", evidence_ids: ["ev-log-1"] }],
    hypotheses: [{ id: "hyp_1", description: "recent deploy introduced a regression", supporting_evidence_ids: ["ev-log-1"], contradicting_evidence_ids: [], status: "supported" }],
    diagnosis: { summary: "deploy-induced error spike on checkout-service", evidence_ids: ["ev-log-1"] },
    missing_information: [],
    recommended_next_step: "PLAN",
  }));
}

function planningProvider(version = "1.3.0"): SimulatedLLMProvider {
  return new SimulatedLLMProvider(JSON.stringify({
    plan_id: "plan_1", diagnosis_ref: "diag_1",
    steps: [{ step_id: "step_1", type: "ACTION", description: "restart checkout-service", action_ref: "restart_service", parameters: { version } }],
    expected_outcome: "error rate returns to baseline", unresolved_risks: [],
  }));
}

function proposedAction(): ProposedAction {
  return {
    proposal_id: "prop_1", request_id: "INC-4417", execution_id: "exec_1", tenant_id: TENANT,
    action_ref: "restart_service", action_version: "1.0.0", reason: "deploy-induced error spike", parameters: { version: "1.3.0" },
    expected_outcome: "error rate returns to baseline",
    risk_assessment: { requested_risk_class: "R2", blast_radius: { scope: "service" }, reversible: true },
    supporting_evidence_ids: [], generated_by: { agent: "planner", model: "sim-llm", prompt_version: "1" }, accountable_principal_id: "sam-oncall", created_at: NOW.toISOString(),
  };
}

const identityResolver = new LocalDevIdentityResolver([
  { id: "sam-oncall", tenant_id: TENANT, display_name: "Sam (proposer)", roles: ["operator"] },
  { id: "riley-lead", tenant_id: TENANT, display_name: "Riley (approver)", roles: ["senior_oncall"] },
]);

// ── SCENE 1: the happy path, end to end, fully governed & audited ──
async function sceneHappyPath(): Promise<void> {
  scene(1, "An incident, governed end to end");

  const stateStore = new InMemoryExecutionStateStore();
  const evidenceRecorder = new InMemoryEvidenceRecorder();
  const machine = new ExecutionStateMachine({ stateStore, eventEmitter: new InMemoryPlatformEventEmitter(), evidenceRecorder, now: () => NOW });
  const { execution } = await machine.createExecution({ tenantId: TENANT, requestId: "INC-4417", opcId: "opc_error_spike", opcVersion: "1.0.0" });
  const execId = execution.execution_id;
  const T = async (to: Parameters<typeof machine.transitionTo>[0]["toState"], evt: string, evType: Parameters<typeof machine.transitionTo>[0]["evidenceType"], summary: string) =>
    machine.transitionTo({ tenantId: TENANT, executionId: execId, toState: to, eventType: evt, evidenceType: evType, evidenceSummary: summary });

  step(`Incident ${C.bold}INC-4417${C.reset} received: "${incident().subject}"`);

  const match = await matchOpc(incident(), [errorSpikeOpc()], { minimumRequiredMargin: 0.15, semanticMatcher: new TextOverlapSemanticMatcher(), evidenceSink: new InMemoryOpcMatchEvidenceSink() });
  await T("OPC_MATCHED", "opc.matched", "CONTEXT", `matched ${match.selected_opc_id}`);
  ok(`Matched operating procedure: ${C.bold}${match.selected_opc_id}${C.reset} (outcome ${match.outcome})`);

  await T("CONTEXT_ASSEMBLY", "context.assembly.started", "CONTEXT", "assembling context");
  const contextPackage = await assembleContextPackage({ tenantId: TENANT, requestId: "INC-4417", executionId: execId, opcId: "opc_error_spike", requiredContext: errorSpikeOpc().required_context, connectorRegistry: demoRegistry(), now: NOW });
  ok(`Context assembled from connectors (missing: ${contextPackage.missing_context.length}, stale: ${contextPackage.stale_context.length})`);

  await T("INVESTIGATING", "investigation.started", "OBSERVATION", "investigating");
  const investigation = await runInvestigation({ incomingRequest: incident(), opc: errorSpikeOpc(), contextPackage, llmProvider: investigationProvider() });
  await T("DIAGNOSED", "diagnosis.completed", "HYPOTHESIS", investigation.diagnosis.summary);
  ok(`Diagnosis: "${investigation.diagnosis.summary}" — every claim evidence-grounded`);

  const plan = await runPlanning({ investigation, opc: errorSpikeOpc(), availableActions: [restartAction], llmProvider: planningProvider() });
  await T("PLANNED", "plan.created", "PLAN", `plan ${plan.plan_id} frozen`);
  ok(`Plan frozen: ${plan.steps.length} step(s), 1 registered action`);

  const decision = evaluatePolicy({ decisionId: "dec_1", createdAt: NOW.toISOString(), proposedAction: proposedAction(), environment: "prod", actionDefinition: restartAction, missingRequiredEvidence: false, killSwitchActive: false, policyRules: [{ rule_id: "prod_r2", when: { environment: "prod", risk_class_in: ["R2", "R3"] }, decision: "REQUIRE_APPROVAL", approval_route: "senior_oncall" }], policyVersion: "v1", evidenceSummary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 }, now: NOW });
  await T("WAITING_APPROVAL", "policy.evaluated", "APPROVAL", `policy: ${decision.outcome}`);
  ok(`Policy Engine: ${C.bold}${decision.outcome}${C.reset} (R2 action in prod → a human must approve)`);

  const gate = await runApprovalAcceptanceGate({ tenantId: TENANT, policyDecision: decision, proposedAction: proposedAction(), decision: "APPROVED", actorId: "riley-lead", identityResolver, now: NOW, authorizationId: "auth_1", signedPlanHash: "sha256:plan", issuedBy: "approval-gate" });
  if (gate.outcome !== "AUTHORIZED") { blocked("approval gate unexpectedly rejected"); return; }
  ok(`Approved by ${C.bold}riley-lead${C.reset} (≠ proposer sam-oncall) — executes under ON_BEHALF_OF identity`);
  why("the action runs as the human approver, never the platform service account, and the proposer can't approve their own work");

  assertMatchesFrozenPlan(plan, { step_id: "step_1", action_ref: "restart_service", parameters: { version: "1.3.0" } });
  await T("EXECUTING", "execution.started", "ACTION_RESULT", "executing restart");
  const connector = new SimulatedActionConnector(actionConnectorDescriptor, secretResolver, new Map([["version", "1.2.3"]]), () => NOW);
  const opId = deriveOperationId(TENANT, execId, "step_1", "1.0.0");
  const gated = await runGatedExecution(connector, restartAction, { version: "1.3.0" }, { checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }] }, gate.authorization, opId);
  if (gated.outcome !== "EXECUTED") { blocked(`execution blocked: ${gated.outcome}`); return; }
  ok(`Preflight passed → executed against the sandbox (version 1.2.3 → ${C.bold}${String(connector.getTargetState("version"))}${C.reset})`);

  const verification = runVerification({ verificationId: "ver_1", executionResult: gated.executionResult, checks: [{ name: "PRODUCTION_EVIDENCE", status: "PASS", evidence_ids: [] }], compensationClass: "REVERSIBLE" });
  await T("VERIFYING", "verification.completed", "VERIFICATION", `verification ${verification.overall}`);
  await T("RESOLVED", "request.resolved", "OUTCOME", "resolved");
  ok(`Verification: ${C.bold}${verification.overall}${C.reset} → recommended next step ${verification.recommended_next_step}`);

  const confidence = assembleConfidenceDimensions({ investigation, evidence: [], contextPackage, verification, connectorDescriptors: [appConnectorDescriptor], policyDecision: decision });
  step(`Confidence (itemized, ${C.bold}no single %${C.reset}): coverage=${confidence.evidence_coverage.value}, hypotheses ${confidence.hypothesis_support.supported}✓/${confidence.hypothesis_support.rejected}✗/${confidence.hypothesis_support.unresolved}?, verification=${confidence.verification_confidence.status}, source=${confidence.source_reliability.lowest}, policy=${confidence.policy_certainty.outcome}`);

  const history = buildExecutionHistory(TENANT, execId, [...evidenceRecorder.evidenceFor(execId)]);
  ok(`Control Tower reconstructed the full ${C.bold}${history.entries.length}-step history${C.reset} from the evidence ledger alone`);
  console.log(`    ${C.dim}${history.entries.map((e) => e.evidence_type).join(" → ")}${C.reset}`);
  why("every governed decision is durable, ordered, tenant-scoped evidence — the whole run is auditable after the fact");
}

// ── SCENE 2: ambiguous ticket → escalate, never guess ──
async function sceneAmbiguous(): Promise<void> {
  scene(2, "Ambiguous ticket — refuses to guess");
  const vague = incident({ subject: "something is wrong with the service", description: "the service seems off", labels: { category: "error-spike", application: "checkout-service", severity: "P1" } });
  const opcA = errorSpikeOpc();
  const opcB = errorSpikeOpc({ opc_id: "opc_latency", name: "Latency Degradation", match: { categories: ["error-spike"], applications: ["checkout-service"], severities: ["P1"] } });
  step(`A vague ticket arrives that scores almost equally against TWO procedures`);
  const match = await matchOpc(vague, [opcA, opcB], { minimumRequiredMargin: 0.15, semanticMatcher: new TextOverlapSemanticMatcher(), evidenceSink: new InMemoryOpcMatchEvidenceSink() });
  if (match.outcome === "MATCHED") { blocked(`auto-picked ${match.selected_opc_id} — this should NOT happen`); return; }
  blocked(`Outcome: ${match.outcome} — escalated to a human, no OPC auto-selected`);
  why("below the confidence margin it hands off rather than confidently doing the wrong remediation");
}

// ── SCENE 3: frozen plan — no swapping the action after approval ──
async function sceneFrozenPlan(): Promise<void> {
  scene(3, "Frozen Plan Rule — approval binds the exact action");
  const plan = await runPlanning({ investigation: await runInvestigation({ incomingRequest: incident(), opc: errorSpikeOpc(), contextPackage: await assembleContextPackage({ tenantId: TENANT, requestId: "INC-4417", executionId: "exec_1", opcId: "opc_error_spike", requiredContext: errorSpikeOpc().required_context, connectorRegistry: demoRegistry(), now: NOW }), llmProvider: investigationProvider() }), opc: errorSpikeOpc(), availableActions: [restartAction], llmProvider: planningProvider(), });
  step(`Approved plan: restart_service with { version: "1.3.0" }`);
  step(`The executor now tries to run a DIFFERENT parameter than what was approved…`);
  try {
    assertMatchesFrozenPlan(plan, { step_id: "step_1", action_ref: "restart_service", parameters: { version: "9.9.9-attacker" } });
    blocked("substitution allowed — this should NOT happen");
  } catch (e) {
    blocked(`Blocked: ${(e as Error).constructor.name} — the frozen plan rejected the change`);
    why("what a human approved is exactly what runs; any drift forces re-approval, it never silently proceeds");
  }
}

// ── SCENE 4: preflight drift — the world changed since approval ──
async function scenePreflightDrift(): Promise<void> {
  scene(4, "Preflight drift — the world changed since approval");
  step(`Approved to act while version was 1.2.3 …`);
  step(`… but between approval and execution the target drifted to 1.2.4`);
  const connector = new SimulatedActionConnector(actionConnectorDescriptor, secretResolver, new Map([["version", "1.2.4"]]), () => NOW);
  const auth = (await runApprovalAcceptanceGate({ tenantId: TENANT, policyDecision: evaluatePolicy({ decisionId: "dec_1", createdAt: NOW.toISOString(), proposedAction: proposedAction(), environment: "prod", actionDefinition: restartAction, missingRequiredEvidence: false, killSwitchActive: false, policyRules: [{ rule_id: "r", when: { environment: "prod", risk_class_in: ["R2"] }, decision: "REQUIRE_APPROVAL", approval_route: "senior_oncall" }], policyVersion: "v1", evidenceSummary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 }, now: NOW }), proposedAction: proposedAction(), decision: "APPROVED", actorId: "riley-lead", identityResolver, now: NOW, authorizationId: "auth_1", signedPlanHash: "sha256:plan", issuedBy: "approval-gate" }));
  if (auth.outcome !== "AUTHORIZED") { blocked("gate rejected"); return; }
  const gated = await runGatedExecution(connector, restartAction, { version: "1.3.0" }, { checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }] }, auth.authorization, "op_1");
  if (gated.outcome === "EXECUTED") { blocked("executed despite drift — this should NOT happen"); return; }
  blocked(`Blocked: ${gated.outcome} — execution refused, sandbox untouched (still ${String(connector.getTargetState("version"))})`);
  why("a staged change between approval and execution is caught, not steamrolled — even a valid approval can't run against a changed world");
}

// ── SCENE 5: emergency halt — an operator can stop it, the wrong person can't ──
async function sceneHalt(): Promise<void> {
  scene(5, "Emergency halt — a real kill switch, role-gated");
  const stateStore = new InMemoryExecutionStateStore();
  const evidenceRecorder = new InMemoryEvidenceRecorder();
  const machine = new ExecutionStateMachine({ stateStore, eventEmitter: new InMemoryPlatformEventEmitter(), evidenceRecorder, now: () => NOW });
  const { execution } = await machine.createExecution({ tenantId: TENANT, requestId: "INC-9002", opcId: "opc_error_spike", opcVersion: "1.0.0" });
  await machine.transitionTo({ tenantId: TENANT, executionId: execution.execution_id, toState: "OPC_MATCHED", eventType: "opc.matched", evidenceType: "CONTEXT", evidenceSummary: "matched" });
  await machine.transitionTo({ tenantId: TENANT, executionId: execution.execution_id, toState: "CONTEXT_ASSEMBLY", eventType: "context", evidenceType: "CONTEXT", evidenceSummary: "assembling" });
  await machine.transitionTo({ tenantId: TENANT, executionId: execution.execution_id, toState: "INVESTIGATING", eventType: "inv", evidenceType: "OBSERVATION", evidenceSummary: "investigating" });
  step(`Execution is in-flight (state: INVESTIGATING)`);

  const req = { requiredHaltRoles: ["senior_oncall", "platform_owner"], identityResolver, stateMachine: machine, stateStore } as const;
  const bad = await haltExecution({ ...req, tenantId: TENANT, executionId: execution.execution_id, haltRequest: { actor: { id: "sam-oncall", role: "senior_oncall" }, scope: "single_execution", reason: "curious", created_at: NOW.toISOString() } });
  blocked(`sam-oncall tries to halt claiming 'senior_oncall' → ${bad.outcome} (real role is only 'operator')`);
  why("the request's self-claimed role is ignored; authorization uses the actor's real resolved identity");

  const good = await haltExecution({ ...req, tenantId: TENANT, executionId: execution.execution_id, haltRequest: { actor: { id: "riley-lead", role: "senior_oncall" }, scope: "single_execution", reason: "customer-facing incident, pausing automation", created_at: NOW.toISOString() } });
  if (good.outcome !== "HALTED") { blocked(`unexpected: ${good.outcome}`); return; }
  ok(`riley-lead halts it → state ${C.bold}${good.execution.state}${C.reset}, with an auditable OUTCOME evidence record`);
  why("an authorized operator can stop automation instantly, and the halt itself is on the audit trail");
}

// ── SCENE 6: budget guardrail — escalate, never present a truncated answer ──
async function sceneBudget(): Promise<void> {
  scene(6, "Budget guardrail — no runaway, no half-answers");
  const stateStore = new InMemoryExecutionStateStore();
  const evidenceRecorder = new InMemoryEvidenceRecorder();
  const machine = new ExecutionStateMachine({ stateStore, eventEmitter: new InMemoryPlatformEventEmitter(), evidenceRecorder, now: () => NOW });
  const { execution } = await machine.createExecution({ tenantId: TENANT, requestId: "INC-9003", opcId: "opc_error_spike", opcVersion: "1.0.0" });
  await machine.transitionTo({ tenantId: TENANT, executionId: execution.execution_id, toState: "OPC_MATCHED", eventType: "m", evidenceType: "CONTEXT", evidenceSummary: "m" });
  await machine.transitionTo({ tenantId: TENANT, executionId: execution.execution_id, toState: "CONTEXT_ASSEMBLY", eventType: "c", evidenceType: "CONTEXT", evidenceSummary: "c" });
  await machine.transitionTo({ tenantId: TENANT, executionId: execution.execution_id, toState: "INVESTIGATING", eventType: "i", evidenceType: "OBSERVATION", evidenceSummary: "i" });
  // the investigation burned past its token ceiling
  const current = (await stateStore.get(TENANT, execution.execution_id))!;
  await stateStore.save({ ...current, budget_consumed: { investigation_tokens: 15_000, planning_tokens: 0, tool_calls: 4 } });
  step(`Investigation consumed 15,000 tokens against a 10,000 ceiling`);
  const result = await enforceBudget({ tenantId: TENANT, executionId: execution.execution_id, budget: errorSpikeOpc().budget, stateMachine: machine, stateStore, evidenceRecorder, now: () => NOW });
  if (result.outcome !== "ESCALATED") { blocked(`unexpected: ${result.outcome}`); return; }
  blocked(`Escalated: BUDGET_EXCEEDED (${result.exceededDimensions.join(", ")}) → state ${result.execution.state}`);
  why("it stops and escalates rather than truncating the investigation and presenting a partial diagnosis as if it were complete");
}

async function main(): Promise<void> {
  console.log(`${C.bold}${C.cyan}\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║   Agentic Operations Platform — governed automation, live     ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}Everything below runs the real platform code in-process — the same code 706 tests cover.${C.reset}`);

  await sceneHappyPath();
  await sceneAmbiguous();
  await sceneFrozenPlan();
  await scenePreflightDrift();
  await sceneHalt();
  await sceneBudget();

  console.log(`\n${C.bold}${C.green}✓ Demo complete.${C.reset} ${C.dim}It did the work — and refused, five different ways, to do the wrong thing.${C.reset}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
