/**
 * The interactive scenario engine. It runs the SAME real governed pipeline
 * and safety rails the narrated CLI demo runs (apps/demo) and the 706-test
 * suite covers — but instead of printing to a console it drives a Presenter,
 * so every step lands live in the UI and in a Slack thread. Scene 1 (the
 * happy path) parks at the Approval Acceptance Gate and awaits a real human
 * decision from EITHER surface via the DecisionRegistry before it continues.
 *
 * Excluded from unit coverage with the rest of engine/** — it orchestrates
 * live network/Slack I/O for a presentation, exactly like apps/demo. The
 * guarantees it demonstrates are the ones the @aop packages' own tests pin.
 */
import {
  matchOpc,
  InMemoryOpcMatchEvidenceSink,
  TextOverlapSemanticMatcher,
  evaluatePolicy,
  runApprovalAcceptanceGate,
} from "@aop/policy-engine";
import { assembleContextPackage } from "@aop/context-service";
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
  ExecutionStateMachine,
  InMemoryExecutionStateStore,
  InMemoryPlatformEventEmitter,
  InMemoryEvidenceRecorder,
  haltExecution,
  enforceBudget,
} from "@aop/worker";
import type { DecisionRegistry } from "../decision-registry.js";
import type { IncidentStore } from "../incident-store.js";
import { Presenter } from "./presenter.js";
import * as F from "./fixtures.js";

export interface RunScenarioDeps {
  scene: number;
  incidentId: string;
  store: IncidentStore;
  decisions: DecisionRegistry;
  presenter: Presenter;
  now: () => Date;
}

const N = F.NOW;

export async function runScenario(deps: RunScenarioDeps): Promise<void> {
  await deps.presenter.start();
  try {
    switch (deps.scene) {
      case 1:
        await sceneHappyPath(deps);
        break;
      case 2:
        await sceneAmbiguous(deps);
        break;
      case 3:
        await sceneFrozenPlan(deps);
        break;
      case 4:
        await scenePreflightDrift(deps);
        break;
      case 5:
        await sceneHalt(deps);
        break;
      case 6:
        await sceneBudget(deps);
        break;
      default:
        await deps.presenter.blocked(`Unknown scene ${deps.scene}`);
        deps.store.setStatus(deps.incidentId, deps.now().toISOString(), "FAILED");
    }
  } catch (err) {
    await deps.presenter.blocked(`Engine error: ${(err as Error).message}`);
    deps.store.setStatus(deps.incidentId, deps.now().toISOString(), "FAILED");
  }
}

// ── SCENE 1: happy path, with a LIVE approval gate ──
async function sceneHappyPath(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now } = deps;
  const stateStore = new InMemoryExecutionStateStore();
  const evidenceRecorder = new InMemoryEvidenceRecorder();
  const machine = new ExecutionStateMachine({ stateStore, eventEmitter: new InMemoryPlatformEventEmitter(), evidenceRecorder, now: () => N });
  const { execution } = await machine.createExecution({ tenantId: F.TENANT, requestId: "INC-4417", opcId: "opc_error_spike", opcVersion: "1.0.0" });
  const execId = execution.execution_id;
  const T = (to: Parameters<typeof machine.transitionTo>[0]["toState"], evt: string, evType: Parameters<typeof machine.transitionTo>[0]["evidenceType"], summary: string) =>
    machine.transitionTo({ tenantId: F.TENANT, executionId: execId, toState: to, eventType: evt, evidenceType: evType, evidenceSummary: summary });

  await presenter.step(`Incident INC-4417 received: "${F.incident().subject}"`);

  const match = await matchOpc(F.incident(), [F.errorSpikeOpc()], { minimumRequiredMargin: 0.15, semanticMatcher: new TextOverlapSemanticMatcher(), evidenceSink: new InMemoryOpcMatchEvidenceSink() });
  await T("OPC_MATCHED", "opc.matched", "CONTEXT", `matched ${match.selected_opc_id}`);
  await presenter.lane("OPC_MATCHED");
  await presenter.ok(`Matched operating procedure: ${match.selected_opc_id} (outcome ${match.outcome})`, "CONTEXT");

  await T("CONTEXT_ASSEMBLY", "context.assembly.started", "CONTEXT", "assembling context");
  await presenter.lane("CONTEXT");
  const contextPackage = await assembleContextPackage({ tenantId: F.TENANT, requestId: "INC-4417", executionId: execId, opcId: "opc_error_spike", requiredContext: F.errorSpikeOpc().required_context, connectorRegistry: F.demoRegistry(), now: N });
  await presenter.ok(`Context assembled from connectors (missing: ${contextPackage.missing_context.length}, stale: ${contextPackage.stale_context.length})`, "CONTEXT");

  await T("INVESTIGATING", "investigation.started", "OBSERVATION", "investigating");
  await presenter.lane("INVESTIGATING");
  const investigation = await runInvestigation({ incomingRequest: F.incident(), opc: F.errorSpikeOpc(), contextPackage, llmProvider: F.investigationProvider() });
  await T("DIAGNOSED", "diagnosis.completed", "HYPOTHESIS", investigation.diagnosis.summary);
  await presenter.lane("DIAGNOSED");
  await presenter.ok(`Diagnosis: "${investigation.diagnosis.summary}" — every claim evidence-grounded`, "HYPOTHESIS");

  const plan = await runPlanning({ investigation, opc: F.errorSpikeOpc(), availableActions: [F.restartAction], llmProvider: F.planningProvider() });
  await T("PLANNED", "plan.created", "PLAN", `plan ${plan.plan_id} frozen`);
  await presenter.lane("PLANNED");
  await presenter.ok(`Plan frozen: ${plan.steps.length} step(s), 1 registered action`, "PLAN");

  const decision = evaluatePolicy({ decisionId: "dec_1", createdAt: N.toISOString(), proposedAction: F.proposedAction(), environment: "prod", actionDefinition: F.restartAction, missingRequiredEvidence: false, killSwitchActive: false, policyRules: [{ rule_id: "prod_r2", when: { environment: "prod", risk_class_in: ["R2", "R3"] }, decision: "REQUIRE_APPROVAL", approval_route: "senior_oncall" }], policyVersion: "v1", evidenceSummary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 }, now: N });
  await T("WAITING_APPROVAL", "policy.evaluated", "APPROVAL", `policy: ${decision.outcome}`);
  await presenter.lane("WAITING_APPROVAL");
  await presenter.ok(`Policy Engine: ${decision.outcome} (R2 action in prod → a human must approve)`, "APPROVAL");
  store.setStatus(incidentId, now().toISOString(), "WAITING_APPROVAL");

  // Park at the gate. A decision can arrive from the UI or from Slack.
  await presenter.requestApproval({
    proposer: F.PROPOSER_DISPLAY,
    requiredRole: "senior_oncall",
    action: "restart_service",
    parameters: { version: "1.3.0" },
    reason: "deploy-induced error spike on checkout-service; restart is the registered R2 remediation",
  });
  await presenter.why("this is the live gate — approve or reject from the UI or the Slack thread; whichever acts first wins");

  const outcome = await deps.decisions.await(incidentId);
  store.recordDecision(incidentId, now().toISOString(), outcome.decision, F.principalDisplayName(outcome.actorId), outcome.via);

  if (outcome.decision === "REJECTED") {
    await presenter.resolveApproval();
    await presenter.blocked(`Rejected by ${F.principalDisplayName(outcome.actorId)} (via ${outcome.via}) — nothing executes`);
    await presenter.why("a human said no; the platform does not act. The rejection is on the audit trail.");
    store.setStatus(incidentId, now().toISOString(), "REJECTED");
    return;
  }

  const gate = await runApprovalAcceptanceGate({ tenantId: F.TENANT, policyDecision: decision, proposedAction: F.proposedAction(), decision: "APPROVED", actorId: outcome.actorId, identityResolver: F.identityResolver(), now: N, authorizationId: "auth_1", signedPlanHash: "sha256:plan", issuedBy: "approval-gate" });
  await presenter.resolveApproval();
  if (gate.outcome !== "AUTHORIZED") {
    await presenter.blocked(`Approval Acceptance Gate refused: ${gate.outcome} (actor ${F.principalDisplayName(outcome.actorId)})`);
    await presenter.why("separation of duties — the proposer cannot approve their own action; only a different, senior approver can");
    store.setStatus(incidentId, now().toISOString(), "ESCALATED");
    return;
  }
  await presenter.ok(`Approved by ${F.principalDisplayName(outcome.actorId)} (different from proposer ${F.PROPOSER_DISPLAY}, via ${outcome.via}) — ON_BEHALF_OF authorization issued`, "APPROVAL");
  await presenter.why("the authorization carries the resolved human approver identity; this demo connector then applies the approved action only to a sandbox");

  assertMatchesFrozenPlan(plan, { step_id: "step_1", action_ref: "restart_service", parameters: { version: "1.3.0" } });
  await T("EXECUTING", "execution.started", "ACTION_RESULT", "executing restart");
  await presenter.lane("EXECUTING");
  const connector = new SimulatedActionConnector(F.actionConnectorDescriptor, F.secretResolver, new Map([["version", "1.2.3"]]), () => N);
  const opId = deriveOperationId(F.TENANT, execId, "step_1", "1.0.0");
  const gated = await runGatedExecution(connector, F.restartAction, { version: "1.3.0" }, { checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }] }, gate.authorization, opId);
  if (gated.outcome !== "EXECUTED") {
    await presenter.blocked(`Execution blocked: ${gated.outcome}`);
    store.setStatus(incidentId, now().toISOString(), "BLOCKED");
    return;
  }
  await presenter.ok(`Preflight passed → executed against the sandbox (version 1.2.3 → ${String(connector.getTargetState("version"))})`, "ACTION_RESULT");

  const verification = runVerification({ verificationId: "ver_1", executionResult: gated.executionResult, checks: [{ name: "PRODUCTION_EVIDENCE", status: "PASS", evidence_ids: [] }], compensationClass: "REVERSIBLE" });
  await T("VERIFYING", "verification.completed", "VERIFICATION", `verification ${verification.overall}`);
  await presenter.lane("VERIFYING");
  await presenter.ok(`Verification: ${verification.overall} → recommended next step ${verification.recommended_next_step}`, "VERIFICATION");

  await T("RESOLVED", "request.resolved", "OUTCOME", "resolved");
  const confidence = assembleConfidenceDimensions({ investigation, evidence: [], contextPackage, verification, connectorDescriptors: [F.appConnectorDescriptor], policyDecision: decision });
  await presenter.step(`Confidence (itemized, no single %): coverage=${confidence.evidence_coverage.value}, hypotheses ${confidence.hypothesis_support.supported}✓/${confidence.hypothesis_support.rejected}✗/${confidence.hypothesis_support.unresolved}?, verification=${confidence.verification_confidence.status}, source=${confidence.source_reliability.lowest}`);

  const history = buildExecutionHistory(F.TENANT, execId, [...evidenceRecorder.evidenceFor(execId)]);
  await presenter.lane("RESOLVED");
  await presenter.ok(`Control Tower reconstructed the full ${history.entries.length}-step history from the evidence ledger alone`, "OUTCOME");
  await presenter.why("every governed decision is durable, ordered, tenant-scoped evidence — the whole run is auditable after the fact");
  store.setStatus(incidentId, now().toISOString(), "RESOLVED");
}

// ── SCENE 2: ambiguous ticket → escalate ──
async function sceneAmbiguous(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now } = deps;
  const vague = F.incident({ subject: "something is wrong with the service", description: "the service seems off" });
  const opcA = F.errorSpikeOpc();
  const opcB = F.errorSpikeOpc({ opc_id: "opc_latency", name: "Latency Degradation" });
  await presenter.step("A vague ticket arrives that scores almost equally against TWO procedures");
  await presenter.lane("OPC_MATCHED");
  const match = await matchOpc(vague, [opcA, opcB], { minimumRequiredMargin: 0.15, semanticMatcher: new TextOverlapSemanticMatcher(), evidenceSink: new InMemoryOpcMatchEvidenceSink() });
  if (match.outcome === "MATCHED") {
    await presenter.blocked(`Auto-picked ${match.selected_opc_id} — this should NOT happen`);
    store.setStatus(incidentId, now().toISOString(), "FAILED");
    return;
  }
  await presenter.blocked(`Outcome: ${match.outcome} — escalated to a human, no OPC auto-selected`);
  await presenter.why("below the confidence margin it hands off rather than confidently doing the wrong remediation");
  store.setStatus(incidentId, now().toISOString(), "ESCALATED");
}

// ── SCENE 3: frozen plan ──
async function sceneFrozenPlan(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now } = deps;
  const contextPackage = await assembleContextPackage({ tenantId: F.TENANT, requestId: "INC-4417", executionId: "exec_1", opcId: "opc_error_spike", requiredContext: F.errorSpikeOpc().required_context, connectorRegistry: F.demoRegistry(), now: N });
  const plan = await runPlanning({ investigation: await runInvestigation({ incomingRequest: F.incident(), opc: F.errorSpikeOpc(), contextPackage, llmProvider: F.investigationProvider() }), opc: F.errorSpikeOpc(), availableActions: [F.restartAction], llmProvider: F.planningProvider() });
  await presenter.lane("WAITING_APPROVAL");
  await presenter.step('Approved plan: restart_service with { version: "1.3.0" }');
  await presenter.step("The executor now tries to run a DIFFERENT parameter than what was approved…");
  try {
    assertMatchesFrozenPlan(plan, { step_id: "step_1", action_ref: "restart_service", parameters: { version: "9.9.9-attacker" } });
    await presenter.blocked("Substitution allowed — this should NOT happen");
    store.setStatus(incidentId, now().toISOString(), "FAILED");
  } catch (e) {
    await presenter.blocked(`Blocked: ${(e as Error).constructor.name} — the frozen plan rejected the change`);
    await presenter.why("what a human approved is exactly what runs; any drift forces re-approval, it never silently proceeds");
    store.setStatus(incidentId, now().toISOString(), "BLOCKED");
  }
}

// ── SCENE 4: preflight drift ──
async function scenePreflightDrift(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now } = deps;
  await presenter.lane("EXECUTING");
  await presenter.step("Approved to act while version was 1.2.3 …");
  await presenter.step("… but between approval and execution the target drifted to 1.2.4");
  const connector = new SimulatedActionConnector(F.actionConnectorDescriptor, F.secretResolver, new Map([["version", "1.2.4"]]), () => N);
  const gate = await runApprovalAcceptanceGate({ tenantId: F.TENANT, policyDecision: evaluatePolicy({ decisionId: "dec_1", createdAt: N.toISOString(), proposedAction: F.proposedAction(), environment: "prod", actionDefinition: F.restartAction, missingRequiredEvidence: false, killSwitchActive: false, policyRules: [{ rule_id: "r", when: { environment: "prod", risk_class_in: ["R2"] }, decision: "REQUIRE_APPROVAL", approval_route: "senior_oncall" }], policyVersion: "v1", evidenceSummary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 }, now: N }), proposedAction: F.proposedAction(), decision: "APPROVED", actorId: F.APPROVER, identityResolver: F.identityResolver(), now: N, authorizationId: "auth_1", signedPlanHash: "sha256:plan", issuedBy: "approval-gate" });
  if (gate.outcome !== "AUTHORIZED") {
    await presenter.blocked("Gate rejected");
    store.setStatus(incidentId, now().toISOString(), "FAILED");
    return;
  }
  const gated = await runGatedExecution(connector, F.restartAction, { version: "1.3.0" }, { checks: [{ field_ref: "version", expected_value: "1.2.3", tolerance: "exact" }] }, gate.authorization, "op_1");
  if (gated.outcome === "EXECUTED") {
    await presenter.blocked("Executed despite drift — this should NOT happen");
    store.setStatus(incidentId, now().toISOString(), "FAILED");
    return;
  }
  await presenter.blocked(`Blocked: ${gated.outcome} — execution refused, sandbox untouched (still ${String(connector.getTargetState("version"))})`);
  await presenter.why("a staged change between approval and execution is caught, not steamrolled — even a valid approval can't run against a changed world");
  store.setStatus(incidentId, now().toISOString(), "BLOCKED");
}

// ── SCENE 5: emergency halt ──
async function sceneHalt(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now } = deps;
  const stateStore = new InMemoryExecutionStateStore();
  const evidenceRecorder = new InMemoryEvidenceRecorder();
  const machine = new ExecutionStateMachine({ stateStore, eventEmitter: new InMemoryPlatformEventEmitter(), evidenceRecorder, now: () => N });
  const { execution } = await machine.createExecution({ tenantId: F.TENANT, requestId: "INC-9002", opcId: "opc_error_spike", opcVersion: "1.0.0" });
  await machine.transitionTo({ tenantId: F.TENANT, executionId: execution.execution_id, toState: "OPC_MATCHED", eventType: "opc.matched", evidenceType: "CONTEXT", evidenceSummary: "matched" });
  await machine.transitionTo({ tenantId: F.TENANT, executionId: execution.execution_id, toState: "CONTEXT_ASSEMBLY", eventType: "context", evidenceType: "CONTEXT", evidenceSummary: "assembling" });
  await machine.transitionTo({ tenantId: F.TENANT, executionId: execution.execution_id, toState: "INVESTIGATING", eventType: "inv", evidenceType: "OBSERVATION", evidenceSummary: "investigating" });
  await presenter.lane("INVESTIGATING");
  await presenter.step("Execution is in-flight (state: INVESTIGATING)");

  const req = { requiredHaltRoles: ["senior_oncall", "platform_owner"], identityResolver: F.identityResolver(), stateMachine: machine, stateStore } as const;
  const bad = await haltExecution({ ...req, tenantId: F.TENANT, executionId: execution.execution_id, haltRequest: { actor: { id: F.PROPOSER, role: "senior_oncall" }, scope: "single_execution", reason: "curious", created_at: N.toISOString() } });
  await presenter.blocked(`${F.PROPOSER_DISPLAY} tries to halt claiming 'senior_oncall' → ${bad.outcome} (real role is only 'operator')`);
  await presenter.why("the request's self-claimed role is ignored; authorization uses the actor's real resolved identity");

  const good = await haltExecution({ ...req, tenantId: F.TENANT, executionId: execution.execution_id, haltRequest: { actor: { id: F.APPROVER, role: "senior_oncall" }, scope: "single_execution", reason: "customer-facing incident, pausing automation", created_at: N.toISOString() } });
  if (good.outcome !== "HALTED") {
    await presenter.blocked(`Unexpected: ${good.outcome}`);
    store.setStatus(incidentId, now().toISOString(), "FAILED");
    return;
  }
  await presenter.ok(`${F.APPROVER_DISPLAY} halts it → state ${good.execution.state}, with an auditable OUTCOME evidence record`, "OUTCOME");
  await presenter.why("an authorized operator can stop automation instantly, and the halt itself is on the audit trail");
  store.setStatus(incidentId, now().toISOString(), "HALTED");
}

// ── SCENE 6: budget guardrail ──
async function sceneBudget(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now } = deps;
  const stateStore = new InMemoryExecutionStateStore();
  const evidenceRecorder = new InMemoryEvidenceRecorder();
  const machine = new ExecutionStateMachine({ stateStore, eventEmitter: new InMemoryPlatformEventEmitter(), evidenceRecorder, now: () => N });
  const { execution } = await machine.createExecution({ tenantId: F.TENANT, requestId: "INC-9003", opcId: "opc_error_spike", opcVersion: "1.0.0" });
  await machine.transitionTo({ tenantId: F.TENANT, executionId: execution.execution_id, toState: "OPC_MATCHED", eventType: "m", evidenceType: "CONTEXT", evidenceSummary: "m" });
  await machine.transitionTo({ tenantId: F.TENANT, executionId: execution.execution_id, toState: "CONTEXT_ASSEMBLY", eventType: "c", evidenceType: "CONTEXT", evidenceSummary: "c" });
  await machine.transitionTo({ tenantId: F.TENANT, executionId: execution.execution_id, toState: "INVESTIGATING", eventType: "i", evidenceType: "OBSERVATION", evidenceSummary: "i" });
  await presenter.lane("INVESTIGATING");
  const current = (await stateStore.get(F.TENANT, execution.execution_id))!;
  await stateStore.save({ ...current, budget_consumed: { investigation_tokens: 15_000, planning_tokens: 0, tool_calls: 4 } });
  await presenter.step("Investigation consumed 15,000 tokens against a 10,000 ceiling");
  const result = await enforceBudget({ tenantId: F.TENANT, executionId: execution.execution_id, budget: F.errorSpikeOpc().budget, stateMachine: machine, stateStore, evidenceRecorder, now: () => N });
  if (result.outcome !== "ESCALATED") {
    await presenter.blocked(`Unexpected: ${result.outcome}`);
    store.setStatus(incidentId, now().toISOString(), "FAILED");
    return;
  }
  await presenter.blocked(`Escalated: BUDGET_EXCEEDED (${result.exceededDimensions.join(", ")}) → state ${result.execution.state}`);
  await presenter.why("it stops and escalates rather than truncating the investigation and presenting a partial diagnosis as if it were complete");
  store.setStatus(incidentId, now().toISOString(), "ESCALATED");
}
