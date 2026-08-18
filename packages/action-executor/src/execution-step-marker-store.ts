import type { ExecutionStepMarker } from "@aop/contracts";

/**
 * ExecutionStepMarkerStore — where `execution_step_marker` rows live
 * (LLD-v1 §2, story D-07). Interface + pluggable-implementation pattern,
 * same precedent as every other store in this codebase (B-01's
 * RawPayloadStore, B-03's ExecutionStateStore) — the real backing store
 * is the `execution_step_marker` table (packages/evidence-ledger),
 * wired up in E-01 without changing this interface.
 */
export interface ExecutionStepMarkerStore {
  get(tenantId: string, executionId: string, stepId: string): Promise<ExecutionStepMarker | undefined>;
  /** Upsert — persists the full current row, keyed by (tenant_id, execution_id, step_id). */
  save(marker: ExecutionStepMarker): Promise<void>;
}

export class InMemoryExecutionStepMarkerStore implements ExecutionStepMarkerStore {
  private readonly markers = new Map<string, ExecutionStepMarker>();

  async get(tenantId: string, executionId: string, stepId: string): Promise<ExecutionStepMarker | undefined> {
    return this.markers.get(key(tenantId, executionId, stepId));
  }

  async save(marker: ExecutionStepMarker): Promise<void> {
    this.markers.set(key(marker.tenant_id, marker.execution_id, marker.step_id), marker);
  }
}

function key(tenantId: string, executionId: string, stepId: string): string {
  return `${tenantId}::${executionId}::${stepId}`;
}
