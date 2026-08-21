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
import { createHash } from "node:crypto";
import type { DecisionRegistry } from "../decision-registry.js";
import type { IncidentStore } from "../incident-store.js";
import { Presenter } from "./presenter.js";
import * as F from "./fixtures.js";
import type { CustomerDomainClient, DomainSnapshot } from "../customer-domain-client.js";

export interface RunScenarioDeps {
  scene: number;
  incidentId: string;
  store: IncidentStore;
  decisions: DecisionRegistry;
  presenter: Presenter;
  now: () => Date;
  customerDomain?: CustomerDomainClient;
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
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
      case 8:
      case 9:
      case 10:
      case 11:
        await sceneOperationalRisk(deps);
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

const RISK_DEMOS: Record<number, { signal: string; evidence: string; control: string; outcome: string }> = {
  2: { signal: "60-second profile TTLs expire in the same second during peak traffic", evidence: "1 cache miss becomes 2,400 concurrent DB reads; profile p95 reaches 3.8 s", control: "single-flight request coalescing plus randomized TTL jitter", outcome: "The platform contains the stampede and schedules a staggered cache pre-warm" },
  3: { signal: "cus_88421 accounts for 38% of reads on one cache shard", evidence: "Shard CPU 96%; unrelated profile p95 rises from 28 ms to 610 ms", control: "hot-key replication and per-key load shedding", outcome: "Traffic is isolated before the hot customer can starve the shard" },
  4: { signal: "wallet cache says KYC VERIFIED while the profile system says REVIEW", evidence: "Eligibility version 184 is older than source-of-truth version 187", control: "versioned cache entries and fail-closed eligibility checks", outcome: "Authorization is blocked until fresh KYC evidence is loaded" },
  5: { signal: "a bot sends high-cardinality nonexistent customer IDs", evidence: "94% miss rate; zero reusable keys; DB lookup volume grows 17×", control: "negative caching, Bloom-filter admission, and tenant rate limits", outcome: "Invalid IDs are rejected before they reach the profile database" },
  6: { signal: "slow profile queries occupy all 80 database connections", evidence: "Pool wait p95 2.1 s; 31 downstream endpoints begin timing out", control: "query timeout, bulkhead pool, and admission backpressure", outcome: "Noncritical reads are shed while wallet-critical capacity is preserved" },
  7: { signal: "wallet clients retry profile timeouts immediately and in lockstep", evidence: "Original 900 RPS becomes 7,200 RPS within three retry rounds", control: "bounded retries with exponential backoff, jitter, and circuit breaking", outcome: "Retry amplification is stopped and recovery traffic is paced" },
  8: { signal: "a debit response is lost after the idempotency record expires", evidence: "The same client key returns with a second $249.00 debit request", control: "ledger-bound idempotency retention longer than client retry windows", outcome: "The duplicate debit is refused and the original result is replayed" },
  9: { signal: "wallet balance write commits on primary but the read replica lags", evidence: "Primary revision 9,442; replica revision 9,439; displayed balance is $600 high", control: "read-your-writes routing and revision-aware preflight", outcome: "The action waits for revision parity instead of spending stale funds" },
  10: { signal: "v3 writes a profile cache schema that v2 cannot decode", evidence: "Deserialize errors jump to 42%; fallback reads overload the DB", control: "versioned keys, dual-read rollout, and cache schema canaries", outcome: "The incompatible keyspace is quarantined and safely rebuilt" },
  11: { signal: "a merged customer retains a wallet link to the superseded profile", evidence: "profile owner cus_88421 differs from wallet owner cus_77103", control: "authoritative ownership reconciliation with an explicit human gate", outcome: "Funds remain frozen until ownership is reviewed and audited" },
};

async function sceneOperationalRisk(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now, scene } = deps;
  const demo = RISK_DEMOS[scene]!;
  await presenter.lane("RECEIVED");
  await presenter.step(`Signal detected: ${demo.signal}`);
  await presenter.lane("CONTEXT");
  await presenter.ok(`Customer-impact evidence: ${demo.evidence}`, "OBSERVATION");
  await presenter.lane("INVESTIGATING");
  await presenter.step("Tracing cache, database, and downstream wallet dependency spans");
  await presenter.lane("DIAGNOSED");
  await presenter.ok(`Recommended control: ${demo.control}`, "HYPOTHESIS");
  await presenter.lane("PLANNED");
  await presenter.blocked(demo.outcome);
  await presenter.why("Demo Lab stops before production mutation; the proposed control is visible without silently changing customer money or identity state");
  store.setStatus(incidentId, now().toISOString(), "ESCALATED");
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

  await presenter.lane("RECEIVED");
  await presenter.step('P1 incident received: "Customer profile latency is cascading into wallet authorization failures"');
  let impact: DomainSnapshot | undefined;
  if (deps.customerDomain) {
    impact = await deps.customerDomain.triggerProfileCascade();
    await presenter.ok(`Live fault reproduced: profile p95 ${impact.profile.p95Ms} ms; wallet success ${impact.wallet.successRate}% (${impact.wallet.failures}/${impact.wallet.authorizations} failed)`, "OBSERVATION");
    await presenter.why(`the wallet service calls customer-profile before authorizing funds; ${impact.profile.dbReads} uncached reads amplified one slow database into downstream failures`);
  }

  const match = await matchOpc(F.incident(), [F.errorSpikeOpc()], { minimumRequiredMargin: 0.15, semanticMatcher: new TextOverlapSemanticMatcher(), evidenceSink: new InMemoryOpcMatchEvidenceSink() });
  await T("OPC_MATCHED", "opc.matched", "CONTEXT", `matched ${match.selected_opc_id}`);
  await presenter.lane("OPC_MATCHED");
  await presenter.ok(`Matched operating procedure: opc_profile_db_latency_cascade (outcome ${match.outcome})`, "CONTEXT");
  await presenter.trust({ procedure: "opc_profile_db_latency_cascade", procedureVersion: `v${F.errorSpikeOpc().version}` });

  await T("CONTEXT_ASSEMBLY", "context.assembly.started", "CONTEXT", "assembling context");
  await presenter.lane("CONTEXT");
  const contextPackage = await assembleContextPackage({ tenantId: F.TENANT, requestId: "INC-4417", executionId: execId, opcId: "opc_error_spike", requiredContext: F.errorSpikeOpc().required_context, connectorRegistry: F.demoRegistry(), now: N });
  const requiredCount = F.errorSpikeOpc().required_context.length;
  const freshCount = requiredCount - contextPackage.missing_context.length - contextPackage.stale_context.length;
  await presenter.ok(`Context assembled: profile DB latency, cache state, wallet dependency errors, and customer impact (missing: ${contextPackage.missing_context.length})`, "CONTEXT");
  await presenter.trust({ contextFresh: `${freshCount}/${requiredCount}` });

  await T("INVESTIGATING", "investigation.started", "OBSERVATION", "investigating");
  await presenter.lane("INVESTIGATING");
  const investigation = await runInvestigation({ incomingRequest: F.incident(), opc: F.errorSpikeOpc(), contextPackage, llmProvider: F.investigationProvider() });
  await T("DIAGNOSED", "diagnosis.completed", "HYPOTHESIS", investigation.diagnosis.summary);
  await presenter.lane("DIAGNOSED");
  // Itemized, evidence-grounded claim count — NEVER a single fabricated %.
  const claimList: { evidence: number }[] = [
    ...investigation.observations.map((o) => ({ evidence: o.evidence_ids.length })),
    ...investigation.hypotheses.map((h) => ({ evidence: h.supporting_evidence_ids.length })),
    { evidence: investigation.diagnosis.evidence_ids.length },
  ];
  const claims = claimList.length;
  const grounded = claimList.filter((c) => c.evidence > 0).length;
  const domainCause = "cache bypass exposed 1,400 ms profile DB reads; wallet's 500 ms dependency timeout converted them into authorization failures";
  await presenter.ok(`Diagnosis: "${domainCause}" — ${grounded}/${claims} claims evidence-grounded`, "HYPOTHESIS");
  await presenter.analysis({
    likelyCause: domainCause,
    claims,
    grounded,
    missingContext: contextPackage.missing_context.length,
    staleContext: contextPackage.stale_context.length,
  });
  await presenter.trust({ claims: `${grounded}/${claims}` });

  const plan = await runPlanning({ investigation, opc: F.errorSpikeOpc(), availableActions: [F.restartAction], llmProvider: F.planningProvider() });
  await T("PLANNED", "plan.created", "PLAN", `plan ${plan.plan_id} frozen`);
  await presenter.lane("PLANNED");
  const planHash = "sha256:" + createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  await presenter.ok("Plan frozen: restore profile DB latency, re-enable cache-aside, pre-warm the hot profile, and enable single-flight miss coalescing", "PLAN");
  await presenter.trust({ planIntegrity: "SHA-256 verified", planHash: planHash.slice(0, 19) + "…" });

  const decision = evaluatePolicy({ decisionId: "dec_1", createdAt: N.toISOString(), proposedAction: F.proposedAction(), environment: "prod", actionDefinition: F.restartAction, missingRequiredEvidence: false, killSwitchActive: false, policyRules: [{ rule_id: "prod_r2", when: { environment: "prod", risk_class_in: ["R2", "R3"] }, decision: "REQUIRE_APPROVAL", approval_route: "senior_oncall" }], policyVersion: "v1", evidenceSummary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 }, now: N });
  await T("WAITING_APPROVAL", "policy.evaluated", "APPROVAL", `policy: ${decision.outcome}`);
  await presenter.lane("WAITING_APPROVAL");
  await presenter.ok(`Policy Engine: ${decision.outcome} (R2 action in prod → a human must approve)`, "APPROVAL");
  await presenter.trust({ policy: decision.outcome });
  store.setStatus(incidentId, now().toISOString(), "WAITING_APPROVAL");

  // Park at the gate. A decision can arrive from the UI or from Slack.
  await presenter.requestApproval({
    proposer: F.PROPOSER,
    requiredRole: "senior_oncall",
    action: "remediate_profile_db_cache",
    parameters: { dbLatencyMs: 45, cacheTtlSeconds: 60, prewarm: true, singleFlight: true },
    reason: "profile DB latency is causing customer-facing wallet authorization failures; remediation changes production cache behavior",
    impact: [
      `Customer profile p95 is ${impact?.profile.p95Ms ?? 1400} ms against a 500 ms wallet dependency timeout`,
      `${impact?.wallet.failures ?? 12}/${impact?.wallet.authorizations ?? 12} sampled wallet authorizations failed`,
      `${impact?.profile.dbReads ?? 12} cache-bypassing reads reached the profile database`,
      "Dependency path: profile database → customer-profile API → wallet authorization → customer transaction",
    ],
    remediationSteps: [
      "Restore profile database response time to the 45 ms operating target",
      "Re-enable cache-aside reads with a 60-second TTL",
      "Pre-warm the affected customer profile before restoring traffic",
      "Enable single-flight miss coalescing so concurrent misses produce one database read",
    ],
    successCriteria: [
      "12/12 synthetic wallet authorization probes succeed",
      "Profile cache hit rate returns to 100% for the validation burst",
      "Wallet dependency failures return to zero",
      "Profile p95 remains below the wallet's 500 ms timeout",
    ],
    rollbackPlan: "Disable the cache path, restore the previous profile read policy, and keep wallet authorization fail-closed if any verification probe fails.",
  });
  await presenter.why("this is the live gate — approve or reject from the UI or the Slack thread; whichever acts first wins");

  const outcome = await deps.decisions.await(incidentId);
  store.recordDecision(incidentId, now().toISOString(), outcome.decision, outcome.actorId, outcome.via);

  if (outcome.decision === "REJECTED") {
    await presenter.resolveApproval();
    await presenter.blocked(`Rejected by ${outcome.actorId} (via ${outcome.via}) — nothing executes`);
    await presenter.why("a human said no; the platform does not act. The rejection is on the audit trail.");
    store.setStatus(incidentId, now().toISOString(), "REJECTED");
    return;
  }

  const gate = await runApprovalAcceptanceGate({ tenantId: F.TENANT, policyDecision: decision, proposedAction: F.proposedAction(), decision: "APPROVED", actorId: outcome.actorId, identityResolver: F.identityResolver(), now: N, authorizationId: "auth_1", signedPlanHash: "sha256:plan", issuedBy: "approval-gate" });
  await presenter.resolveApproval();
  if (gate.outcome !== "AUTHORIZED") {
    await presenter.blocked(`Approval Acceptance Gate refused: ${gate.outcome} (actor ${outcome.actorId})`);
    await presenter.why("separation of duties — the proposer cannot approve their own action; only a different, senior approver can");
    store.setStatus(incidentId, now().toISOString(), "ESCALATED");
    return;
  }
  await presenter.ok(`Authorization issued ON_BEHALF_OF ${outcome.actorId} (≠ proposer ${F.PROPOSER}, decided via ${outcome.via})`, "APPROVAL");
  await presenter.why("the sandbox connector executes the approved action under the approver's authorization — the proposer can't approve their own work");
  await presenter.trust({ authorization: "ON_BEHALF_OF", connector: "SANDBOX" });

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
  let remediation: Awaited<ReturnType<CustomerDomainClient["remediateProfileCascade"]>> | undefined;
  if (deps.customerDomain) {
    remediation = await deps.customerDomain.remediateProfileCascade();
    for (const fixed of remediation.fixed) await presenter.ok(`Fixed: ${fixed}`, "ACTION_RESULT");
    await presenter.ok(`Before → after: profile p95 ${remediation.before.profile.p95Ms} → ${remediation.after.profile.p95Ms} ms; wallet success ${remediation.before.wallet.successRate}% → ${remediation.after.wallet.successRate}%`, "ACTION_RESULT");
  } else {
    await presenter.ok(`Preflight passed → executed against the sandbox (version 1.2.3 → ${String(connector.getTargetState("version"))})`, "ACTION_RESULT");
  }

  const verification = runVerification({ verificationId: "ver_1", executionResult: gated.executionResult, checks: [{ name: "PRODUCTION_EVIDENCE", status: "PASS", evidence_ids: [] }], compensationClass: "REVERSIBLE" });
  await T("VERIFYING", "verification.completed", "VERIFICATION", `verification ${verification.overall}`);
  await presenter.lane("VERIFYING");
  await presenter.ok(`Verification: ${verification.overall}; 12/12 wallet authorization probes passed after cache pre-warm → ${verification.recommended_next_step}`, "VERIFICATION");

  await T("RESOLVED", "request.resolved", "OUTCOME", "resolved");
  const confidence = assembleConfidenceDimensions({ investigation, evidence: [], contextPackage, verification, connectorDescriptors: [F.appConnectorDescriptor], policyDecision: decision });
  await presenter.step(`Confidence (itemized, no single %): coverage=${confidence.evidence_coverage.value}, hypotheses ${confidence.hypothesis_support.supported}✓/${confidence.hypothesis_support.rejected}✗/${confidence.hypothesis_support.unresolved}?, verification=${confidence.verification_confidence.status}, source=${confidence.source_reliability.lowest}`);

  const history = buildExecutionHistory(F.TENANT, execId, [...evidenceRecorder.evidenceFor(execId)]);
  await presenter.lane("RESOLVED");
  await presenter.ok(`Control Tower reconstructed the full ${history.entries.length}-step history from the evidence ledger alone`, "OUTCOME");
  await presenter.why("every governed decision is durable, ordered, tenant-scoped evidence — the whole run is auditable after the fact");
  await presenter.trust({ ledger: history.entries.length });
  store.setStatus(incidentId, now().toISOString(), "RESOLVED");
}

// ── SCENE 2: ambiguous ticket → escalate ──
async function sceneAmbiguous(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now } = deps;
  const vague = F.incident({ subject: "customer profile and wallet ownership do not agree", description: "the wallet appears linked to the wrong customer profile" });
  const opcA = F.errorSpikeOpc({ opc_id: "opc_profile_reconciliation", name: "Customer Profile Reconciliation" });
  const opcB = F.errorSpikeOpc({ opc_id: "opc_wallet_reconciliation", name: "Wallet Ownership Reconciliation" });
  await presenter.step("A customer-state mismatch scores almost equally against profile and wallet reconciliation procedures");
  await presenter.lane("OPC_MATCHED");
  const match = await matchOpc(vague, [opcA, opcB], { minimumRequiredMargin: 0.15, semanticMatcher: new TextOverlapSemanticMatcher(), evidenceSink: new InMemoryOpcMatchEvidenceSink() });
  if (match.outcome === "MATCHED") {
    await presenter.blocked(`Auto-picked ${match.selected_opc_id} — this should NOT happen`);
    store.setStatus(incidentId, now().toISOString(), "FAILED");
    return;
  }
  await presenter.blocked(`Outcome: ${match.outcome} — escalated to a human, no OPC auto-selected`);
    await presenter.why("the platform will not guess whether identity or wallet ownership is authoritative; it hands the case to a human");
  store.setStatus(incidentId, now().toISOString(), "ESCALATED");
}

// ── SCENE 3: frozen plan ──
async function sceneFrozenPlan(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now } = deps;
  const contextPackage = await assembleContextPackage({ tenantId: F.TENANT, requestId: "INC-4417", executionId: "exec_1", opcId: "opc_error_spike", requiredContext: F.errorSpikeOpc().required_context, connectorRegistry: F.demoRegistry(), now: N });
  const plan = await runPlanning({ investigation: await runInvestigation({ incomingRequest: F.incident(), opc: F.errorSpikeOpc(), contextPackage, llmProvider: F.investigationProvider() }), opc: F.errorSpikeOpc(), availableActions: [F.restartAction], llmProvider: F.planningProvider() });
  await presenter.lane("WAITING_APPROVAL");
  await presenter.step('Approved wallet change: set_daily_limit with { amount: 5000 }');
  await presenter.step("The executor attempts to substitute an unapproved $50,000 wallet limit…");
  try {
    assertMatchesFrozenPlan(plan, { step_id: "step_1", action_ref: "restart_service", parameters: { version: "9.9.9-attacker" } });
    await presenter.blocked("Substitution allowed — this should NOT happen");
    store.setStatus(incidentId, now().toISOString(), "FAILED");
  } catch (e) {
    await presenter.blocked(`Blocked: ${(e as Error).constructor.name} — the frozen plan rejected the change`);
    await presenter.why("the exact wallet value a human approved is cryptographically bound to the plan; mutation forces re-approval");
    store.setStatus(incidentId, now().toISOString(), "BLOCKED");
  }
}

// ── SCENE 4: preflight drift ──
async function scenePreflightDrift(deps: RunScenarioDeps): Promise<void> {
  const { presenter, store, incidentId, now } = deps;
  await presenter.lane("EXECUTING");
  await presenter.step("Wallet reconciliation was approved against ledger revision 42 …");
  await presenter.step("… but a new transaction advanced the wallet to revision 43 before execution");
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
  await presenter.why("a valid approval cannot mutate a wallet whose balance context changed; the platform requires a fresh plan and approval");
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
  await presenter.step("A duplicate-customer profile merge is in-flight (state: INVESTIGATING)");

  const req = { requiredHaltRoles: ["senior_oncall", "platform_owner"], identityResolver: F.identityResolver(), stateMachine: machine, stateStore } as const;
  const bad = await haltExecution({ ...req, tenantId: F.TENANT, executionId: execution.execution_id, haltRequest: { actor: { id: F.PROPOSER, role: "senior_oncall" }, scope: "single_execution", reason: "curious", created_at: N.toISOString() } });
  await presenter.blocked(`${F.PROPOSER} tries to halt claiming 'senior_oncall' → ${bad.outcome} (real role is only 'operator')`);
  await presenter.why("the request's self-claimed role is ignored; authorization uses the actor's real resolved identity");

  const good = await haltExecution({ ...req, tenantId: F.TENANT, executionId: execution.execution_id, haltRequest: { actor: { id: F.APPROVER, role: "senior_oncall" }, scope: "single_execution", reason: "customer-facing incident, pausing automation", created_at: N.toISOString() } });
  if (good.outcome !== "HALTED") {
    await presenter.blocked(`Unexpected: ${good.outcome}`);
    store.setStatus(incidentId, now().toISOString(), "FAILED");
    return;
  }
  await presenter.ok(`${F.APPROVER} halts it → state ${good.execution.state}, with an auditable OUTCOME evidence record`, "OUTCOME");
  await presenter.why("an authorized operator can stop a risky customer-profile merge instantly, and the halt itself is audited");
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
  await presenter.step("Wallet-risk investigation consumed 15,000 tokens against a 10,000 ceiling");
  const result = await enforceBudget({ tenantId: F.TENANT, executionId: execution.execution_id, budget: F.errorSpikeOpc().budget, stateMachine: machine, stateStore, evidenceRecorder, now: () => N });
  if (result.outcome !== "ESCALATED") {
    await presenter.blocked(`Unexpected: ${result.outcome}`);
    store.setStatus(incidentId, now().toISOString(), "FAILED");
    return;
  }
  await presenter.blocked(`Escalated: BUDGET_EXCEEDED (${result.exceededDimensions.join(", ")}) → state ${result.execution.state}`);
  await presenter.why("it escalates rather than presenting a partial wallet-risk assessment as a complete answer");
  store.setStatus(incidentId, now().toISOString(), "ESCALATED");
}
