export interface CacheDatabase {
  readonly backend: string;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

interface Entry {
  value: string;
  expiresAt: number;
}

/**
 * Zero-install cache database for the local demo. It intentionally exposes
 * the tiny Redis-shaped surface the domain needs, so Redis can replace it in
 * production without changing any profile or wallet behavior.
 */
export class EmbeddedTtlCache implements CacheDatabase {
  readonly backend = "embedded-ttl (Redis-compatible demo mode)";
  private readonly entries = new Map<string, Entry>();

  async get(key: string): Promise<string | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

