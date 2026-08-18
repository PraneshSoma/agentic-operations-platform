import type { ExecutionState } from "@aop/contracts";

/**
 * ExecutionStateStore — where the state machine persists ExecutionState
 * rows (spec §7 "1. persist current state"). Interface + pluggable-
 * implementation pattern (ADR-009/012 precedent, B-01's RawPayloadStore,
 * B-02's OpcMatchEvidenceSink) — the real backing store is the
 * `execution` table (packages/evidence-ledger, story A-03), wired up in
 * E-01 without changing this interface or the state machine.
 */
export interface ExecutionStateStore {
  /** Idempotency lookup (spec §31) — one execution per (tenant_id, request_id). */
  findByRequestId(tenantId: string, requestId: string): Promise<ExecutionState | undefined>;
  get(tenantId: string, executionId: string): Promise<ExecutionState | undefined>;
  /** Upsert — persists the full current row. */
  save(execution: ExecutionState): Promise<void>;
}

export class InMemoryExecutionStateStore implements ExecutionStateStore {
  private readonly byExecutionId = new Map<string, ExecutionState>();
  private readonly executionIdByRequestKey = new Map<string, string>();

  async findByRequestId(tenantId: string, requestId: string): Promise<ExecutionState | undefined> {
    const executionId = this.executionIdByRequestKey.get(requestKey(tenantId, requestId));
    return executionId ? this.byExecutionId.get(executionId) : undefined;
  }

  async get(tenantId: string, executionId: string): Promise<ExecutionState | undefined> {
    const execution = this.byExecutionId.get(executionId);
    return execution?.tenant_id === tenantId ? execution : undefined;
  }

  async save(execution: ExecutionState): Promise<void> {
    this.byExecutionId.set(execution.execution_id, execution);
    this.executionIdByRequestKey.set(requestKey(execution.tenant_id, execution.request_id), execution.execution_id);
  }
}

function requestKey(tenantId: string, requestId: string): string {
  return `${tenantId}::${requestId}`;
}
