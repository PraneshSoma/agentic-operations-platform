/**
 * RawPayloadStore — where the trigger adapter preserves a trigger's raw,
 * un-normalized payload before handing back only a `raw_payload_ref`
 * string (spec §4.1 Rules: "raw trigger payload is preserved separately").
 *
 * Interface + pluggable-implementation pattern, matching how ADR-009
 * (SecretResolver) and ADR-012 (IdentityResolver) handle other
 * pluggable I/O concerns: define the interface where the trigger adapter
 * needs it, ship a working local implementation now, and let the real
 * backing store (the Evidence Ledger, as an `Evidence` record of type
 * `REQUEST` — spec §4.6 already has that enum value for exactly this)
 * land in E-01 (Evidence Ledger persistence) without changing this
 * interface or any caller.
 */
export interface RawPayloadStore {
  /** Persists a raw payload, returns the ref other components store instead of the payload itself. */
  store(tenantId: string, rawPayload: unknown): Promise<string>;
  /** Retrieves a previously stored raw payload by its ref, scoped to tenantId (CONTEXT.md RULE 4). */
  retrieve(tenantId: string, ref: string): Promise<unknown | undefined>;
}

/**
 * In-memory implementation — sufficient for local dev and this story's
 * tests. NOT durable: process restart loses every stored payload. Real
 * persistence is E-01's job.
 */
export class InMemoryRawPayloadStore implements RawPayloadStore {
  private readonly payloadsByTenant = new Map<string, Map<string, unknown>>();
  private counter = 0;

  async store(tenantId: string, rawPayload: unknown): Promise<string> {
    const ref = `raw_payload_${tenantId}_${++this.counter}`;
    const tenantMap = this.payloadsByTenant.get(tenantId) ?? new Map<string, unknown>();
    tenantMap.set(ref, rawPayload);
    this.payloadsByTenant.set(tenantId, tenantMap);
    return ref;
  }

  async retrieve(tenantId: string, ref: string): Promise<unknown | undefined> {
    return this.payloadsByTenant.get(tenantId)?.get(ref);
  }

  /** Test/observability helper — how many payloads are currently stored for one tenant. */
  size(tenantId: string): number {
    return this.payloadsByTenant.get(tenantId)?.size ?? 0;
  }
}
