import type { Evidence } from "@aop/contracts";

/**
 * EvidenceRecorder — spec §7 "3. write an evidence record". Interface +
 * pluggable-implementation pattern, same precedent as
 * ExecutionStateStore/PlatformEventEmitter. The real implementation
 * writes an append-only `evidence` row (packages/evidence-ledger, story
 * A-03) — wired up in E-01, not here.
 */
export interface EvidenceRecorder {
  record(evidence: Evidence): Promise<void>;
}

export class InMemoryEvidenceRecorder implements EvidenceRecorder {
  private readonly evidenceByExecutionId = new Map<string, Evidence[]>();

  async record(evidence: Evidence): Promise<void> {
    const records = this.evidenceByExecutionId.get(evidence.execution_id) ?? [];
    records.push(evidence);
    this.evidenceByExecutionId.set(evidence.execution_id, records);
  }

  /** Test/observability helper. */
  evidenceFor(executionId: string): readonly Evidence[] {
    return this.evidenceByExecutionId.get(executionId) ?? [];
  }
}
