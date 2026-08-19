import type { ExecutionResult, ExecutionState, PolicyDecision, ProposedAction } from "@aop/contracts";

/**
 * VersionBindingView (F-20, LLD-v1 §0, story E-06) — the immutable
 * version binding for replayability. Given an execution_id, it returns
 * every element in LLD §0's version-binding table, joined from fields
 * that ALREADY EXIST — a read GUARANTEE, not a new write path
 * (OI-REQ-10's resolution). Pure: the caller fetches the rows, this
 * projects the version-identifying fields out of them.
 *
 * Two elements — frozen plan id and approval id — have no dedicated
 * persisted table yet (spec §32 defers `resolution_plan` / `approval`);
 * they're captured from the evidence chain (PLAN / APPROVAL records)
 * where the orchestrator recorded them, so the caller supplies them as
 * arrays. `evidence_snapshot_reconstructable` is always true — F-16
 * guarantees the full evidence snapshot is reconstructable by
 * execution_id, so this view names that guarantee rather than duplicating
 * the whole ledger.
 */
export interface VersionBindingView {
  tenant_id: string;
  execution_id: string;
  opc_id: string;
  opc_version: string;
  action_bindings: Array<{ action_ref: string; action_version: string }>;
  policy_versions: string[];
  frozen_plan_ids: string[];
  approval_ids: string[];
  model_bindings: Array<{ agent: string; model: string; prompt_version: string }>;
  connector_definition_versions: Array<{ connector_id: string; definition_version: string }>;
  executor_build_hashes: string[];
  evidence_snapshot_reconstructable: true;
}

export interface VersionBindingParts {
  execution: ExecutionState;
  proposedActions: ProposedAction[];
  policyDecisions: PolicyDecision[];
  executionResults: ExecutionResult[];
  connectorDefinitionVersions: Array<{ connector_id: string; definition_version: string }>;
  frozenPlanIds: string[];
  approvalIds: string[];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function buildVersionBindingView(parts: VersionBindingParts): VersionBindingView {
  return {
    tenant_id: parts.execution.tenant_id,
    execution_id: parts.execution.execution_id,
    opc_id: parts.execution.opc_id,
    opc_version: parts.execution.opc_version,
    action_bindings: parts.proposedActions.map((p) => ({ action_ref: p.action_ref, action_version: p.action_version })),
    policy_versions: unique(parts.policyDecisions.map((d) => d.policy_version)),
    frozen_plan_ids: unique(parts.frozenPlanIds),
    approval_ids: unique(parts.approvalIds),
    model_bindings: parts.proposedActions.map((p) => ({
      agent: p.generated_by.agent,
      model: p.generated_by.model,
      prompt_version: p.generated_by.prompt_version,
    })),
    connector_definition_versions: parts.connectorDefinitionVersions,
    executor_build_hashes: unique(parts.executionResults.map((r) => r.executor_build_hash)),
    evidence_snapshot_reconstructable: true,
  };
}
