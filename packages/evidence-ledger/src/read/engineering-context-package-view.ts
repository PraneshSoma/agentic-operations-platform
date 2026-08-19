import type {
  ContextPackage,
  Evidence,
  ExecutionState,
  PolicyDecision,
  ProposedAction,
  VerificationResult,
} from "@aop/contracts";
import { buildExecutionHistory, type ExecutionHistory } from "./execution-history.js";
import type { VersionBindingView } from "./version-binding-view.js";

/**
 * EngineeringContextPackageView (OI-REQ-02, LLD-v1 §0/§6, story E-05) —
 * the derived, READ-ONLY composite served by
 * `GET /tenants/{tenantId}/executions/{executionId}/context-package/composite`.
 *
 * OI-REQ-02's decision is explicit: NO schema change to ContextPackage.
 * This view is a read-time JOIN by execution_id across the rows the
 * pipeline already persisted — the same join-based relationship pattern
 * Evidence itself uses (spec §4.6), never a new stored contract. Assembly
 * here is pure; the Prisma repository just fetches the parts and hands
 * them in.
 */
export interface EngineeringContextPackageView {
  tenant_id: string;
  execution_id: string;
  execution: ExecutionState;
  /** null when context assembly hadn't run for this execution — the view still resolves. */
  context_package: ContextPackage | null;
  proposed_actions: ProposedAction[];
  policy_decisions: PolicyDecision[];
  verifications: VerificationResult[];
  /** The full reconstructed timeline, from evidence alone (F-16). */
  history: ExecutionHistory;
}

export interface EngineeringContextPackageParts {
  execution: ExecutionState;
  contextPackage: ContextPackage | null;
  proposedActions: ProposedAction[];
  policyDecisions: PolicyDecision[];
  verifications: VerificationResult[];
  evidence: Evidence[];
}

export function buildEngineeringContextPackageView(parts: EngineeringContextPackageParts): EngineeringContextPackageView {
  return {
    tenant_id: parts.execution.tenant_id,
    execution_id: parts.execution.execution_id,
    execution: parts.execution,
    context_package: parts.contextPackage,
    proposed_actions: parts.proposedActions,
    policy_decisions: parts.policyDecisions,
    verifications: parts.verifications,
    history: buildExecutionHistory(parts.execution.tenant_id, parts.execution.execution_id, parts.evidence),
  };
}

/**
 * The Control Tower's minimal read surface (F-16). Pluggable so the API
 * route can be exercised with an in-memory fake and the real Prisma
 * implementation stays integration-tested.
 */
export interface ControlTowerRepository {
  getCompositeContextPackage(tenantId: string, executionId: string): Promise<EngineeringContextPackageView | undefined>;
  reconstructExecutionHistory(tenantId: string, executionId: string): Promise<ExecutionHistory | undefined>;
  /** The immutable version binding for replayability (F-20, story E-06) — a read guarantee over already-persisted fields. */
  getVersionBinding(tenantId: string, executionId: string): Promise<VersionBindingView | undefined>;
}
