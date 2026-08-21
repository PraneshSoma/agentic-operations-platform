/**
 * One live P1 plus ten high-impact customer profile / wallet lab incidents.
 * Kept as plain data so the UI, trigger routes, and engine share one catalogue.
 */

export interface Scenario {
  scene: number;
  /** Stable slug used in URLs and Slack action payloads. */
  key: string;
  title: string;
  /** One-line description shown on the trigger button. */
  blurb: string;
  /** True only for the happy path, which parks at a live approval gate. */
  hasApprovalGate: boolean;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    scene: 1,
    key: "happy-path",
    title: "Profile DB latency cascade — governed end to end",
    blurb: "Slow profile DB → wallet failures → approve → remediate → verify",
    hasApprovalGate: true,
  },
  {
    scene: 2,
    key: "cache-stampede",
    title: "Cache stampede after synchronized TTL expiry",
    blurb: "A cold cache fans thousands of requests into the profile database",
    hasApprovalGate: false,
  },
  {
    scene: 3,
    key: "hot-key",
    title: "Hot customer key saturates a cache shard",
    blurb: "One high-traffic profile monopolizes cache capacity and latency",
    hasApprovalGate: false,
  },
  {
    scene: 4,
    key: "stale-kyc",
    title: "Stale KYC state authorizes the wrong wallet behavior",
    blurb: "Cached eligibility disagrees with the profile system of record",
    hasApprovalGate: false,
  },
  {
    scene: 5,
    key: "cache-penetration",
    title: "Invalid customer IDs penetrate the cache",
    blurb: "Nonexistent profile lookups bypass cache and amplify database load",
    hasApprovalGate: false,
  },
  {
    scene: 6,
    key: "pool-exhaustion",
    title: "Profile DB connection pool exhaustion",
    blurb: "Slow queries consume every connection and block unrelated customers",
    hasApprovalGate: false,
  },
  { scene: 7, key: "retry-storm", title: "Wallet retry storm overwhelms profile APIs", blurb: "Retries without jitter multiply a partial dependency failure", hasApprovalGate: false },
  { scene: 8, key: "idempotency-expiry", title: "Wallet idempotency record expires too early", blurb: "A retried debit risks charging a customer twice", hasApprovalGate: false },
  { scene: 9, key: "replica-lag", title: "Read replica lag serves an outdated balance", blurb: "Profile and wallet reads disagree immediately after a write", hasApprovalGate: false },
  { scene: 10, key: "poisoned-cache", title: "Schema rollout poisons cached profiles", blurb: "Mixed application versions cannot deserialize the same cache entry", hasApprovalGate: false },
  { scene: 11, key: "reconciliation-drift", title: "Profile-wallet ownership reconciliation drift", blurb: "A wallet points to a merged or superseded customer identity", hasApprovalGate: false },
] as const;

export function scenarioByKey(key: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.key === key);
}

export function scenarioByScene(scene: number): Scenario | undefined {
  return SCENARIOS.find((s) => s.scene === scene);
}

/**
 * Picks a scenario from free-text (a Slack message body). Matches a scene
 * number ("scene 3", "3") or any scenario key/keyword found in the text;
 * defaults to the happy path when nothing matches, so simply @-mentioning
 * the bot triggers the governed end-to-end run.
 */
export function scenarioKeyFromText(text: string): string {
  const lower = text.toLowerCase();
  const sceneNum = /\bscene\s*(\d+)\b/.exec(lower) ?? /\b(\d+)\b/.exec(lower);
  if (sceneNum) {
    const s = scenarioByScene(Number(sceneNum[1]));
    if (s) {
      return s.key;
    }
  }
  for (const s of SCENARIOS) {
    if (lower.includes(s.key) || lower.includes(s.key.replaceAll("-", " "))) {
      return s.key;
    }
  }
  return SCENARIOS[0]!.key;
}
