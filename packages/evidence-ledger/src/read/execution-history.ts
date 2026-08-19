import type { Evidence } from "@aop/contracts";

/**
 * Execution history reconstruction (F-16, spec §34's named acceptance
 * bar: "an execution's complete history is reconstructable from Evidence
 * Ledger records alone"). Pure — its ONLY input is the execution's
 * evidence records; it needs no other table to produce the timeline,
 * which is exactly what "from Evidence Ledger records alone" means.
 *
 * Every ExecutionState transition writes an Evidence record (RULE 7), so
 * the ordered evidence chain IS the execution's history — this function
 * just orders it and projects each record into a timeline entry.
 */
export interface ExecutionHistoryEntry {
  sequence: number;
  occurred_at: string;
  evidence_type: Evidence["type"];
  summary: string;
  evidence_id: string;
  /** relationships.supersedes, when this record corrects an earlier one (append-only ledger, F-15). */
  supersedes: string | undefined;
}

export interface ExecutionHistory {
  tenant_id: string;
  execution_id: string;
  entries: ExecutionHistoryEntry[];
}

/**
 * Orders an execution's evidence records into a timeline. Sort is by
 * `integrity.created_at`, with `evidence_id` as a deterministic
 * tie-breaker so two records written in the same millisecond still order
 * stably (reconstruction must be reproducible, not clock-jitter-dependent).
 */
export function buildExecutionHistory(tenantId: string, executionId: string, evidence: Evidence[]): ExecutionHistory {
  const ordered = [...evidence].sort((a, b) => {
    const at = new Date(a.integrity.created_at).getTime();
    const bt = new Date(b.integrity.created_at).getTime();
    if (at !== bt) return at - bt;
    return a.evidence_id.localeCompare(b.evidence_id);
  });

  return {
    tenant_id: tenantId,
    execution_id: executionId,
    entries: ordered.map((record, index) => ({
      sequence: index + 1,
      occurred_at: record.integrity.created_at,
      evidence_type: record.type,
      summary: record.content.summary,
      evidence_id: record.evidence_id,
      supersedes: record.relationships.supersedes,
    })),
  };
}
