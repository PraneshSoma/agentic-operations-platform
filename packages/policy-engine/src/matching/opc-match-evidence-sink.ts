import type { OPCMatchResult } from "@aop/contracts";

/**
 * OpcMatchEvidenceSink — where matchOpc() records the OPCMatchResult
 * unconditionally (spec §6A: "written to the Evidence Ledger
 * unconditionally, including all candidates and scores considered, not
 * only the winner"). Interface + pluggable-implementation pattern, same
 * precedent as RawPayloadStore (story B-01) — the real backing store is
 * an Evidence Ledger record (type presumably OBSERVATION or a routing-
 * specific evidence type; the exact Evidence.type mapping is E-01's call
 * to make when it wires real persistence, not guessed at here) landing in
 * E-01 without changing this interface or matchOpc()'s callers.
 */
export interface OpcMatchEvidenceSink {
  record(tenantId: string, result: OPCMatchResult): Promise<void>;
}

/** In-memory implementation — sufficient for local dev and this story's tests. */
export class InMemoryOpcMatchEvidenceSink implements OpcMatchEvidenceSink {
  private readonly recordsByTenant = new Map<string, OPCMatchResult[]>();

  async record(tenantId: string, result: OPCMatchResult): Promise<void> {
    const records = this.recordsByTenant.get(tenantId) ?? [];
    records.push(result);
    this.recordsByTenant.set(tenantId, records);
  }

  /** Test/observability helper. */
  recordsFor(tenantId: string): readonly OPCMatchResult[] {
    return this.recordsByTenant.get(tenantId) ?? [];
  }
}
