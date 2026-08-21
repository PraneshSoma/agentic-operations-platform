export interface DomainSnapshot {
  cacheBackend: string;
  fault: { dbLatencyMs: number; cacheEnabled: boolean; singleFlight: boolean };
  profile: { requests: number; dbReads: number; cacheHits: number; cacheMisses: number; cacheHitRate: number; p95Ms: number };
  wallet: { authorizations: number; failures: number; successRate: number };
}

export interface DomainRemediation {
  fixed: string[];
  before: DomainSnapshot;
  after: DomainSnapshot;
}

export class CustomerDomainClient {
  constructor(private readonly profileUrl = process.env.CUSTOMER_PROFILE_URL ?? "http://127.0.0.1:4101") {}

  async health(): Promise<{ ok: boolean; service?: string; cache?: string; error?: string }> {
    try {
      const response = await fetch(`${this.profileUrl}/healthz`, { signal: AbortSignal.timeout(800) });
      return response.ok ? await response.json() as { ok: boolean; service: string; cache: string } : { ok: false, error: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async triggerProfileCascade(): Promise<DomainSnapshot> {
    const result = await this.post<{ snapshot: DomainSnapshot }>("/demo/trigger/profile-db-cascade", 4000);
    return result.snapshot;
  }

  async remediateProfileCascade(): Promise<DomainRemediation> {
    return this.post<DomainRemediation>("/demo/remediate/profile-db-cascade", 4000);
  }

  async status(): Promise<DomainSnapshot> {
    const response = await fetch(`${this.profileUrl}/demo/status`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) throw new Error(`customer profile service returned HTTP ${response.status}`);
    return response.json() as Promise<DomainSnapshot>;
  }

  private async post<T>(path: string, timeoutMs: number): Promise<T> {
    const response = await fetch(`${this.profileUrl}${path}`, { method: "POST", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`customer profile service returned HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }
}
