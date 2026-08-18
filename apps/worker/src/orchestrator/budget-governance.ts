import { randomUUID } from "node:crypto";
import { EvidenceSchema, type Evidence, type ExecutionState, type OperationalProcedureContract } from "@aop/contracts";
import type { ExecutionStateMachine } from "./state-machine.js";
import type { ExecutionStateStore } from "./execution-state-store.js";
import type { EvidenceRecorder } from "./evidence-recorder.js";

/**
 * Token & cost governance / budget enforcement (D-06, spec §7B, F-12).
 * "Investigation loops over large log/metric volumes have no ceiling
 * without this section" — the orchestrator tracks cumulative usage
 * against `ExecutionState.budget_consumed`, checked against the matched
 * OPC's `budget` block (spec §4.2), at each state transition.
 *
 * Enforcement (spec §7B):
 *   - default `on_exceeded: ESCALATE` — the platform never silently
 *     truncates an investigation and presents a partial diagnosis as
 *     complete; it escalates with `escalation_reason: BUDGET_EXCEEDED`.
 *   - `on_exceeded: STOP_AND_SUMMARIZE` is an explicit tenant opt-in.
 *     Actually PRODUCING a partial summary is an agent-level capability
 *     (an LLM call over whatever investigation/planning happened so
 *     far) that doesn't exist anywhere in this codebase yet and isn't
 *     required by this story's two acceptance criteria — disclosed here
 *     rather than faked: `enforceBudget()` returns a distinct
 *     `REQUIRES_SUMMARIZATION` outcome instead of a state transition,
 *     so the caller can never mistake it for a no-op. It is NOT silently
 *     dropped — that's the one invariant this story's first acceptance
 *     criterion actually requires ("never silently truncates"), and it
 *     holds for both `on_exceeded` values, not just ESCALATE.
 */
export type BudgetDimension = "investigation_tokens" | "planning_tokens" | "tool_calls" | "wall_clock_minutes";

export type BudgetCheckResult =
  | { status: "WITHIN_BUDGET" }
  | { status: "EXCEEDED"; exceededDimensions: readonly BudgetDimension[] };

/**
 * Pure comparison: current `budget_consumed` against the OPC's declared
 * ceilings. Strictly-greater-than: consuming exactly the ceiling is still
 * within budget; going one unit past it is what "exceeded" means.
 */
export function checkBudget(execution: ExecutionState, budget: OperationalProcedureContract["budget"], now: Date): BudgetCheckResult {
  const exceeded: BudgetDimension[] = [];

  if (execution.budget_consumed.investigation_tokens > budget.max_investigation_tokens) {
    exceeded.push("investigation_tokens");
  }
  if (execution.budget_consumed.planning_tokens > budget.max_planning_tokens) {
    exceeded.push("planning_tokens");
  }
  if (execution.budget_consumed.tool_calls > budget.max_tool_calls) {
    exceeded.push("tool_calls");
  }
  const wallClockMinutes = (now.getTime() - new Date(execution.created_at).getTime()) / 60_000;
  if (wallClockMinutes > budget.max_wall_clock_minutes) {
    exceeded.push("wall_clock_minutes");
  }

  return exceeded.length > 0 ? { status: "EXCEEDED", exceededDimensions: exceeded } : { status: "WITHIN_BUDGET" };
}

export type EnforceBudgetResult =
  | { outcome: "WITHIN_BUDGET" }
  | { outcome: "ESCALATED"; execution: ExecutionState; exceededDimensions: readonly BudgetDimension[] }
  | { outcome: "REQUIRES_SUMMARIZATION"; exceededDimensions: readonly BudgetDimension[] };

export interface EnforceBudgetInput {
  tenantId: string;
  executionId: string;
  budget: OperationalProcedureContract["budget"];
  stateMachine: ExecutionStateMachine;
  stateStore: ExecutionStateStore;
  evidenceRecorder: EvidenceRecorder;
  now?: () => Date;
}

/**
 * Runs one budget check and enforces its outcome. Exactly one Evidence
 * record is written per call, satisfying this story's second acceptance
 * criterion ("budget consumption written to the Evidence Ledger per
 * execution") on every path:
 *   - EXCEEDED + ESCALATE: the state transition's own Evidence record
 *     (RULE 7) carries the budget snapshot — no separate write needed.
 *   - WITHIN_BUDGET / EXCEEDED + STOP_AND_SUMMARIZE: no state transition
 *     happens, so a standalone Evidence record is written directly here.
 */
export async function enforceBudget(input: EnforceBudgetInput): Promise<EnforceBudgetResult> {
  const now = input.now?.() ?? new Date();

  const execution = await input.stateStore.get(input.tenantId, input.executionId);
  if (!execution) {
    throw new Error(`No execution "${input.executionId}" for tenant "${input.tenantId}"`);
  }

  const check = checkBudget(execution, input.budget, now);

  if (check.status === "WITHIN_BUDGET") {
    await recordBudgetEvidence(input.evidenceRecorder, execution, now, "Budget check: within budget", {});
    return { outcome: "WITHIN_BUDGET" };
  }

  if (input.budget.on_exceeded === "STOP_AND_SUMMARIZE") {
    await recordBudgetEvidence(
      input.evidenceRecorder,
      execution,
      now,
      `Budget check: exceeded (${check.exceededDimensions.join(", ")}) — STOP_AND_SUMMARIZE requested, summarization not performed by this call`,
      { exceeded_dimensions: check.exceededDimensions },
    );
    return { outcome: "REQUIRES_SUMMARIZATION", exceededDimensions: check.exceededDimensions };
  }

  // default: ESCALATE
  const updated = await input.stateMachine.transitionTo({
    tenantId: input.tenantId,
    executionId: input.executionId,
    toState: "ESCALATED",
    eventType: "request.escalated",
    evidenceType: "OUTCOME",
    evidenceSummary: `Execution escalated: BUDGET_EXCEEDED (${check.exceededDimensions.join(", ")})`,
    structuredData: {
      escalation_reason: "BUDGET_EXCEEDED",
      exceeded_dimensions: check.exceededDimensions,
      budget_consumed: execution.budget_consumed,
      budget_limits: input.budget,
    },
  });

  return { outcome: "ESCALATED", execution: updated, exceededDimensions: check.exceededDimensions };
}

async function recordBudgetEvidence(
  evidenceRecorder: EvidenceRecorder,
  execution: ExecutionState,
  now: Date,
  summary: string,
  extraStructuredData: Record<string, unknown>,
): Promise<void> {
  const evidence: Evidence = EvidenceSchema.parse({
    evidence_id: randomUUID(),
    tenant_id: execution.tenant_id,
    request_id: execution.request_id,
    execution_id: execution.execution_id,
    type: "OUTCOME",
    source: { component: "orchestrator.budget_governance" },
    content: {
      summary,
      structured_data: { budget_consumed: execution.budget_consumed, ...extraStructuredData },
    },
    relationships: {},
    integrity: { created_at: now.toISOString(), content_hash: `sha256:placeholder-budget-${execution.execution_id}-${now.getTime()}` },
    retention_class: "operational_state",
    // Same naive dev-default as state-machine.ts's own evidence writes —
    // real per-class retention computation is E-01's job (ADR-011).
    retention_expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    retention_policy_version: "v0-dev-default",
    legal_hold: false,
  });

  await evidenceRecorder.record(evidence);
}
