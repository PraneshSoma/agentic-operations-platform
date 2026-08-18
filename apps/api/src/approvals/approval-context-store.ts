import type { PolicyDecision, ProposedAction } from "@aop/contracts";

export interface ApprovalContext {
  policyDecision: PolicyDecision;
  proposedAction: ProposedAction;
}

/**
 * ApprovalContextStore — where the approval decision endpoint looks up
 * the PolicyDecision + ProposedAction an approval_id refers to. Interface
 * + pluggable-implementation pattern, same precedent as every other I/O
 * boundary this session (RawPayloadStore, OpcMatchEvidenceSink,
 * ExecutionStateStore, ...). The real backing store is the Evidence
 * Ledger, wired up in E-01, without changing this interface or its
 * caller.
 */
export interface ApprovalContextStore {
  get(tenantId: string, approvalId: string): Promise<ApprovalContext | undefined>;
}

export class InMemoryApprovalContextStore implements ApprovalContextStore {
  private readonly contexts = new Map<string, ApprovalContext>();

  set(tenantId: string, approvalId: string, context: ApprovalContext): void {
    this.contexts.set(key(tenantId, approvalId), context);
  }

  async get(tenantId: string, approvalId: string): Promise<ApprovalContext | undefined> {
    return this.contexts.get(key(tenantId, approvalId));
  }
}

function key(tenantId: string, approvalId: string): string {
  return `${tenantId}::${approvalId}`;
}
