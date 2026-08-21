import Fastify, { type FastifyInstance } from "fastify";
import { EmbeddedTtlCache } from "./cache.js";

type CustomerStatus = "ACTIVE" | "REVIEW" | "BLOCKED";
interface CustomerProfile {
  customerId: string;
  name: string;
  segment: "STANDARD" | "PLUS" | "PRIVATE";
  status: CustomerStatus;
  kyc: "VERIFIED" | "REVIEW";
  walletId: string;
  updatedAt: string;
}

interface Wallet {
  walletId: string;
  customerId: string;
  currency: string;
  availableBalance: number;
  status: "OPEN" | "FROZEN";
}

interface Metrics {
  profileRequests: number;
  profileDbReads: number;
  cacheHits: number;
  cacheMisses: number;
  walletAuthorizations: number;
  walletFailures: number;
  profileLatenciesMs: number[];
}

const PROFILE_PORT = Number(process.env.PROFILE_PORT ?? 4101);
const WALLET_PORT = Number(process.env.WALLET_PORT ?? 4102);
const PROFILE_URL = process.env.PROFILE_URL ?? `http://127.0.0.1:${PROFILE_PORT}`;
const cache = new EmbeddedTtlCache();
const inflight = new Map<string, Promise<CustomerProfile>>();

const profiles = new Map<string, CustomerProfile>([
  ["cus_88421", { customerId: "cus_88421", name: "Maya Chen", segment: "PLUS", status: "ACTIVE", kyc: "VERIFIED", walletId: "wal_3019", updatedAt: "2026-08-21T13:22:04.000Z" }],
  ["cus_19702", { customerId: "cus_19702", name: "Noah Williams", segment: "STANDARD", status: "ACTIVE", kyc: "VERIFIED", walletId: "wal_7742", updatedAt: "2026-08-21T13:18:31.000Z" }],
]);
const wallets = new Map<string, Wallet>([
  ["cus_88421", { walletId: "wal_3019", customerId: "cus_88421", currency: "USD", availableBalance: 8240.32, status: "OPEN" }],
  ["cus_19702", { walletId: "wal_7742", customerId: "cus_19702", currency: "USD", availableBalance: 1298.12, status: "OPEN" }],
]);

const fault = { dbLatencyMs: 45, cacheEnabled: true, singleFlight: true };
let metrics = freshMetrics();

function freshMetrics(): Metrics {
  return { profileRequests: 0, profileDbReads: 0, cacheHits: 0, cacheMisses: 0, walletAuthorizations: 0, walletFailures: 0, profileLatenciesMs: [] };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]!;
}

function snapshot() {
  const attempts = metrics.walletAuthorizations;
  return {
    cacheBackend: cache.backend,
    fault: { ...fault },
    profile: {
      requests: metrics.profileRequests,
      dbReads: metrics.profileDbReads,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses,
      cacheHitRate: metrics.profileRequests ? Math.round((metrics.cacheHits / metrics.profileRequests) * 100) : 0,
      p95Ms: percentile(metrics.profileLatenciesMs, 0.95),
    },
    wallet: {
      authorizations: attempts,
      failures: metrics.walletFailures,
      successRate: attempts ? Math.round(((attempts - metrics.walletFailures) / attempts) * 100) : 100,
    },
  };
}

async function readProfileFromDatabase(customerId: string): Promise<CustomerProfile> {
  metrics.profileDbReads += 1;
  await sleep(fault.dbLatencyMs);
  const profile = profiles.get(customerId);
  if (!profile) throw new Error("PROFILE_NOT_FOUND");
  return profile;
}

async function getProfile(customerId: string): Promise<{ profile: CustomerProfile; source: "CACHE" | "DATABASE" }> {
  const key = `profile:${customerId}`;
  const started = Date.now();
  metrics.profileRequests += 1;
  try {
    if (fault.cacheEnabled) {
      const cached = await cache.get(key);
      if (cached) {
        metrics.cacheHits += 1;
        return { profile: JSON.parse(cached) as CustomerProfile, source: "CACHE" };
      }
    }
    metrics.cacheMisses += 1;
    let load = inflight.get(key);
    if (!load || !fault.singleFlight) {
      load = readProfileFromDatabase(customerId);
      if (fault.singleFlight) inflight.set(key, load);
    }
    const profile = await load;
    if (fault.cacheEnabled) await cache.set(key, JSON.stringify(profile), 60);
    return { profile, source: "DATABASE" };
  } finally {
    inflight.delete(key);
    metrics.profileLatenciesMs.push(Math.max(1, Date.now() - started));
  }
}

async function runWalletBurst(count = 12): Promise<void> {
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    try {
      await fetch(`http://127.0.0.1:${WALLET_PORT}/wallets/cus_88421/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 125 + index }),
      });
    } catch {
      // Metrics are recorded by the wallet service; the demo burst continues.
    }
  }));
  // Let aborted profile reads finish so the DB amplification is observable.
  await sleep(Math.min(fault.dbLatencyMs + 40, 1500));
}

function profileService(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.get("/healthz", async () => ({ ok: true, service: "customer-profile", cache: cache.backend }));
  app.get("/profiles/:customerId", async (req, reply) => {
    const { customerId } = req.params as { customerId: string };
    try {
      const result = await getProfile(customerId);
      reply.header("x-profile-source", result.source);
      return result;
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });
  app.get("/demo/status", async () => snapshot());
  app.post("/demo/reset", async () => {
    fault.dbLatencyMs = 45; fault.cacheEnabled = true; fault.singleFlight = true;
    metrics = freshMetrics(); await cache.clear();
    return snapshot();
  });
  app.post("/demo/trigger/profile-db-cascade", async () => {
    metrics = freshMetrics();
    fault.dbLatencyMs = 1400;
    fault.cacheEnabled = false;
    fault.singleFlight = false;
    await cache.delete("profile:cus_88421");
    await runWalletBurst();
    return {
      incident: "PROFILE_DB_LATENCY_CASCADE",
      customerId: "cus_88421",
      impact: "wallet authorization depends on customer profile eligibility",
      snapshot: snapshot(),
    };
  });
  app.post("/demo/remediate/profile-db-cascade", async () => {
    const before = snapshot();
    fault.dbLatencyMs = 45;
    fault.cacheEnabled = true;
    fault.singleFlight = true;
    await cache.delete("profile:cus_88421");
    const profile = await readProfileFromDatabase("cus_88421");
    await cache.set("profile:cus_88421", JSON.stringify(profile), 60);
    metrics = freshMetrics();
    await runWalletBurst();
    return {
      fixed: [
        "Restored profile database latency from 1,400 ms to 45 ms",
        "Re-enabled 60-second cache-aside reads",
        "Pre-warmed the affected customer profile",
        "Enabled single-flight miss coalescing to prevent a cache stampede",
      ],
      before,
      after: snapshot(),
    };
  });
  return app;
}

function walletService(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.get("/healthz", async () => ({ ok: true, service: "wallet", profileDependency: PROFILE_URL }));
  app.get("/wallets/:customerId", async (req, reply) => {
    const { customerId } = req.params as { customerId: string };
    const wallet = wallets.get(customerId);
    return wallet ?? reply.code(404).send({ error: "WALLET_NOT_FOUND" });
  });
  app.post("/wallets/:customerId/authorize", async (req, reply) => {
    const { customerId } = req.params as { customerId: string };
    const body = (req.body ?? {}) as { amount?: number };
    metrics.walletAuthorizations += 1;
    const wallet = wallets.get(customerId);
    if (!wallet || wallet.status !== "OPEN") {
      metrics.walletFailures += 1;
      return reply.code(409).send({ authorized: false, reason: "WALLET_UNAVAILABLE" });
    }
    try {
      const response = await fetch(`${PROFILE_URL}/profiles/${customerId}`, { signal: AbortSignal.timeout(500) });
      if (!response.ok) throw new Error(`PROFILE_${response.status}`);
      const { profile } = await response.json() as { profile: CustomerProfile };
      if (profile.status !== "ACTIVE" || profile.kyc !== "VERIFIED") throw new Error("PROFILE_INELIGIBLE");
      if ((body.amount ?? 0) > wallet.availableBalance) throw new Error("INSUFFICIENT_FUNDS");
      return { authorized: true, walletId: wallet.walletId, profileStatus: profile.status };
    } catch (error) {
      metrics.walletFailures += 1;
      return reply.code(503).send({ authorized: false, reason: "PROFILE_DEPENDENCY_TIMEOUT", detail: (error as Error).message });
    }
  });
  return app;
}

const profile = profileService();
const wallet = walletService();
await Promise.all([
  profile.listen({ port: PROFILE_PORT, host: "127.0.0.1" }),
  wallet.listen({ port: WALLET_PORT, host: "127.0.0.1" }),
]);
profile.log.info(`customer-profile listening on :${PROFILE_PORT} (${cache.backend})`);
wallet.log.info(`wallet listening on :${WALLET_PORT}; downstream profile=${PROFILE_URL}`);
