import { randomUUID } from "node:crypto";
import { EvidenceSchema, ExecutionStateSchema, PlatformEventSchema, type Evidence, type ExecutionState } from "@aop/contracts";
import type { ExecutionStateStore } from "./execution-state-store.js";
import type { PlatformEventEmitter } from "./platform-event-emitter.js";
import type { EvidenceRecorder } from "./evidence-recorder.js";

type State = ExecutionState["state"];

/**
 * The full ExecutionState graph (spec §7's flat enum + LLD-v1 §4's
 * EXECUTION_UNCERTAIN sub-graph, combined). Story B-03 is the
 * orchestrator *skeleton* — it enforces which transitions are legal and
 * RULE 7's persist/emit/evidence contract on every one of them; the
 * business logic that decides WHEN to make a given transition (running
 * an investigation, evaluating policy, etc.) is later stories' job
 * (B-04 through D-07).
 *
 * ESCALATED_HUMAN_OVERRIDE is reachable from every non-terminal state
 * (story D-05, spec §7A) — a halt is "a way to stop something already
 * executing or awaiting a step," which by definition can arrive at any
 * point before an execution reaches one of its own terminal states.
 */
const ALLOWED_TRANSITIONS: Record<State, readonly State[]> = {
  RECEIVED: ["OPC_MATCHED", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  OPC_MATCHED: ["CONTEXT_ASSEMBLY", "ESCALATED", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  CONTEXT_ASSEMBLY: ["INVESTIGATING", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  INVESTIGATING: ["DIAGNOSED", "ESCALATED", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  DIAGNOSED: ["PLANNED", "ESCALATED", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  PLANNED: ["WAITING_APPROVAL", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  WAITING_APPROVAL: ["EXECUTING", "ESCALATED", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  // LLD-v1 §4: normal completion goes straight to VERIFYING; a worker
  // restart mid-execution with an ATTEMPTED (not COMPLETED) marker goes
  // to EXECUTION_UNCERTAIN instead.
  EXECUTING: ["EXECUTION_UNCERTAIN", "VERIFYING", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  // LLD-v1 §4's exact three proof-gated exits — see UncertainExitProof below.
  // No fourth entry beyond those three plus the halt escape hatch below
  // (ADR-004: no default/timeout exit — a halt is neither, it's an
  // explicit, authorized, auditable human action, spec §7A).
  EXECUTION_UNCERTAIN: ["EXECUTING", "VERIFYING", "ESCALATED_HUMAN_OVERRIDE"],
  VERIFYING: ["RESOLVED", "ROLLING_BACK", "ESCALATED", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  ROLLING_BACK: ["RESOLVED", "ESCALATED", "FAILED", "ESCALATED_HUMAN_OVERRIDE"],
  RESOLVED: [],
  ESCALATED: [],
  ESCALATED_HUMAN_OVERRIDE: [],
  FAILED: [],
};

/**
 * The proof required to leave EXECUTION_UNCERTAIN (LLD-v1 §4, ADR-004).
 * There is deliberately no exit that doesn't carry one of these three —
 * "no default/timeout fallback" is enforced by the type system, not just
 * documented: transitionTo() below requires this parameter whenever the
 * execution is currently EXECUTION_UNCERTAIN, and rejects any proof/
 * target-state combination that doesn't match the LLD §4 diagram.
 */
export type UncertainExitProof =
  | { kind: "operation_did_not_occur"; operation_id: string }
  | { kind: "operation_completed"; operation_id: string }
  | { kind: "inconclusive_not_idempotent"; operation_id: string; reason: string };

const UNCERTAIN_EXIT_TARGET: Record<UncertainExitProof["kind"], State> = {
  operation_did_not_occur: "EXECUTING",
  operation_completed: "VERIFYING",
  inconclusive_not_idempotent: "ESCALATED_HUMAN_OVERRIDE",
};

export interface CreateExecutionInput {
  tenantId: string;
  requestId: string;
  opcId: string;
  opcVersion: string;
}

export interface CreateExecutionResult {
  execution: ExecutionState;
  /** false when this call was an idempotent no-op — spec §31. */
  created: boolean;
}

export interface TransitionInput {
  tenantId: string;
  executionId: string;
  toState: State;
  eventType: string;
  evidenceType: Evidence["type"];
  evidenceSummary: string;
  structuredData?: Record<string, unknown>;
  /** Required if and only if the execution is currently EXECUTION_UNCERTAIN. */
  uncertainExitProof?: UncertainExitProof;
}

export interface ExecutionStateMachineDeps {
  stateStore: ExecutionStateStore;
  eventEmitter: PlatformEventEmitter;
  evidenceRecorder: EvidenceRecorder;
  now?: () => Date;
}

/**
 * ExecutionStateMachine — the durable orchestrator's state machine
 * skeleton (spec §7, story B-03).
 */
export class ExecutionStateMachine {
  constructor(private readonly deps: ExecutionStateMachineDeps) {}

  /**
   * Creates a new execution for an IncomingRequest, or returns the
   * existing one unchanged if this (tenant_id, request_id) already has
   * one — spec §31's idempotency key for "execution creation" reduces to
   * (tenant_id, request_id) at this entry point (plan_id/step_id/
   * action_version apply to later idempotency keys — approval callbacks,
   * action execution — not creation). A re-delivered trigger is a true
   * no-op: it does NOT re-persist, re-emit, or re-record evidence.
   */
  async createExecution(input: CreateExecutionInput): Promise<CreateExecutionResult> {
    const existing = await this.deps.stateStore.findByRequestId(input.tenantId, input.requestId);
    if (existing) {
      return { execution: existing, created: false };
    }

    const now = this.now();
    const execution = ExecutionStateSchema.parse({
      execution_id: randomUUID(),
      tenant_id: input.tenantId,
      request_id: input.requestId,
      opc_id: input.opcId,
      opc_version: input.opcVersion,
      state: "RECEIVED",
      proposal_ids: [],
      retry_count: 0,
      budget_consumed: { investigation_tokens: 0, planning_tokens: 0, tool_calls: 0 },
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    await this.applyTransition(execution, {
      eventType: "request.received",
      evidenceType: "REQUEST",
      evidenceSummary: `Execution ${execution.execution_id} created for request ${input.requestId}`,
    });

    return { execution, created: true };
  }

  /**
   * Transitions an existing execution. Validates the transition against
   * ALLOWED_TRANSITIONS, then applies RULE 7's persist -> emit -> evidence
   * sequence, in that exact order, every time.
   */
  async transitionTo(input: TransitionInput): Promise<ExecutionState> {
    const current = await this.deps.stateStore.get(input.tenantId, input.executionId);
    if (!current) {
      throw new Error(`No execution ${input.executionId} for tenant ${input.tenantId}`);
    }

    this.assertLegalTransition(current.state, input.toState, input.uncertainExitProof);

    const now = this.now();
    const updated: ExecutionState = { ...current, state: input.toState, updated_at: now.toISOString() };

    await this.applyTransition(updated, {
      eventType: input.eventType,
      evidenceType: input.evidenceType,
      evidenceSummary: input.evidenceSummary,
      structuredData: input.structuredData,
    });

    return updated;
  }

  private assertLegalTransition(from: State, to: State, proof: UncertainExitProof | undefined): void {
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(`Illegal transition ${from} -> ${to}`);
    }

    if (from === "EXECUTION_UNCERTAIN") {
      if (!proof) {
        throw new Error(
          `Leaving EXECUTION_UNCERTAIN requires an uncertainExitProof (LLD-v1 §4, ADR-004) — ` +
            `no default/timeout exit is permitted`,
        );
      }
      const expectedTarget = UNCERTAIN_EXIT_TARGET[proof.kind];
      if (expectedTarget !== to) {
        throw new Error(
          `uncertainExitProof kind "${proof.kind}" proves an exit to ${expectedTarget}, not ${to} — ` +
            `proof and target state must match LLD-v1 §4's diagram exactly`,
        );
      }
    } else if (proof) {
      throw new Error(`uncertainExitProof is only valid when leaving EXECUTION_UNCERTAIN (current state: ${from})`);
    }
  }

  /** RULE 7 / spec §7: persist, then emit, then evidence — every transition, same order, every time. */
  private async applyTransition(
    execution: ExecutionState,
    opts: {
      eventType: string;
      evidenceType: Evidence["type"];
      evidenceSummary: string;
      structuredData?: Record<string, unknown> | undefined;
    },
  ): Promise<void> {
    const now = this.now();

    // 1. persist current state
    await this.deps.stateStore.save(execution);

    // 2. emit an event
    await this.deps.eventEmitter.emit(
      PlatformEventSchema.parse({
        event_id: randomUUID(),
        event_type: opts.eventType,
        tenant_id: execution.tenant_id,
        request_id: execution.request_id,
        execution_id: execution.execution_id,
        occurred_at: now.toISOString(),
        payload_ref: `state:${execution.execution_id}:${execution.state}`,
        correlation_id: execution.request_id,
      }),
    );

    // 3. write an evidence record
    await this.deps.evidenceRecorder.record(
      EvidenceSchema.parse({
        evidence_id: randomUUID(),
        tenant_id: execution.tenant_id,
        request_id: execution.request_id,
        execution_id: execution.execution_id,
        type: opts.evidenceType,
        source: { component: "orchestrator.state_machine" },
        content: { summary: opts.evidenceSummary, structured_data: opts.structuredData },
        relationships: {},
        integrity: { created_at: now.toISOString(), content_hash: `sha256:placeholder-${execution.execution_id}-${execution.state}` },
        retention_class: "operational_state",
        // Placeholder only — real per-class retention computation (ADR-011)
        // is E-01's job. A same-instant expiry would be actively
        // misleading, so this uses a naive fixed 30-day dev-default
        // instead of pretending to compute the real policy here.
        retention_expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        retention_policy_version: "v0-dev-default",
        legal_hold: false,
      }),
    );
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
