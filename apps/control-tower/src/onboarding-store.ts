import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type AppEnvironment = "DEVELOPMENT" | "STAGING" | "PRODUCTION";
export type AccessMode = "READ_ONLY" | "CONTROLLED_WRITE" | "FULL";
export type TriggerType = "WEBHOOK" | "SLACK" | "METRIC" | "SCHEDULE" | "EVENT_BUS";
export type RiskClass = "R0" | "R1" | "R2" | "R3";

export interface ServiceAccessConfig {
  mode: AccessMode;
  allowedActions: string[];
  credentialRef?: string | undefined;
  approvalRequired: boolean;
}

export interface OnboardedService {
  id: string;
  name: string;
  baseUrl: string;
  healthPath: string;
  access: ServiceAccessConfig;
}

export interface AppTrigger {
  id: string;
  type: TriggerType;
  event: string;
  condition: string;
  severity: "P1" | "P2" | "P3";
  enabled: boolean;
}

export interface AppSop {
  id: string;
  name: string;
  version: string;
  matchTerms: string[];
  serviceIds: string[];
  steps: string[];
  riskClass: RiskClass;
  approvalRole?: string | undefined;
  enabled: boolean;
}

export interface OnboardedApp {
  id: string;
  name: string;
  owner: string;
  environment: AppEnvironment;
  description: string;
  status: "ACTIVE" | "DRAFT";
  services: OnboardedService[];
  triggers: AppTrigger[];
  sops: AppSop[];
  createdAt: string;
  updatedAt: string;
}

export type OnboardedAppInput = Omit<OnboardedApp, "id" | "createdAt" | "updatedAt"> & { id?: string | undefined };

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

export function validateOnboarding(input: OnboardedAppInput): ValidationResult {
  const issues: string[] = [];
  if (!input.name?.trim()) issues.push("Application name is required");
  if (!input.owner?.trim()) issues.push("Application owner is required");
  if (!input.services?.length) issues.push("At least one service is required");
  if (!input.triggers?.length) issues.push("At least one trigger is required");
  if (!input.sops?.length) issues.push("At least one SOP is required");

  const serviceIds = new Set<string>();
  for (const service of input.services ?? []) {
    if (!service.id?.trim() || serviceIds.has(service.id)) issues.push("Every service needs a unique id");
    serviceIds.add(service.id);
    if (!service.name?.trim()) issues.push(`Service ${service.id || "(unknown)"} needs a name`);
    if (!/^https?:\/\//.test(service.baseUrl)) issues.push(`Service ${service.name || service.id} needs an http(s) base URL`);
    if (!service.access.allowedActions.length) issues.push(`Service ${service.name || service.id} needs at least one allowed action`);
    if (service.access.credentialRef && !/^(env|vault|aws-sm|gcp-sm|azure-kv):/.test(service.access.credentialRef)) {
      issues.push(`Service ${service.name || service.id} credential must be a reference such as env:NAME or vault:path, never a secret value`);
    }
  }

  for (const trigger of input.triggers ?? []) {
    if (!trigger.event?.trim()) issues.push("Every trigger needs an event or signal name");
    if (!trigger.condition?.trim()) issues.push(`Trigger ${trigger.event || "(unknown)"} needs a condition`);
  }

  for (const sop of input.sops ?? []) {
    if (!sop.name?.trim()) issues.push("Every SOP needs a name");
    if (!sop.matchTerms.length) issues.push(`SOP ${sop.name || "(unknown)"} needs match terms`);
    if (!sop.steps.length) issues.push(`SOP ${sop.name || "(unknown)"} needs execution steps`);
    if (!sop.serviceIds.length || sop.serviceIds.some((id) => !serviceIds.has(id))) issues.push(`SOP ${sop.name || "(unknown)"} references an unknown service`);
    if ((sop.riskClass === "R2" || sop.riskClass === "R3") && !sop.approvalRole?.trim()) issues.push(`SOP ${sop.name || "(unknown)"} requires an approval role for ${sop.riskClass}`);
  }
  return { ok: issues.length === 0, issues };
}

function seed(now: string): OnboardedApp {
  return {
    id: "app_customer_wallet",
    name: "Customer Profile & Wallet",
    owner: "Commerce Platform",
    environment: "PRODUCTION",
    description: "Customer identity, eligibility, and wallet authorization services used by the incident demo.",
    status: "ACTIVE",
    services: [
      { id: "customer-profile", name: "Customer Profile", baseUrl: "http://127.0.0.1:4101", healthPath: "/healthz", access: { mode: "CONTROLLED_WRITE", allowedActions: ["read_profile", "flush_profile_cache", "prewarm_profile", "set_db_latency"], credentialRef: "env:CUSTOMER_PROFILE_TOKEN", approvalRequired: true } },
      { id: "wallet", name: "Wallet", baseUrl: "http://127.0.0.1:4102", healthPath: "/healthz", access: { mode: "READ_ONLY", allowedActions: ["read_wallet", "probe_authorization"], credentialRef: "env:WALLET_SERVICE_TOKEN", approvalRequired: true } },
    ],
    triggers: [
      { id: "trigger_profile_latency", type: "METRIC", event: "profile.db.p95", condition: "> 500ms for 3 minutes AND wallet failures > 5%", severity: "P1", enabled: true },
      { id: "trigger_slack", type: "SLACK", event: "app_mention", condition: "message contains profile, wallet, latency, or authorization", severity: "P2", enabled: true },
    ],
    sops: [
      { id: "sop_profile_cascade", name: "Profile DB Latency Cascade", version: "1.0.0", matchTerms: ["profile latency", "wallet timeout", "cache bypass"], serviceIds: ["customer-profile", "wallet"], steps: ["Reproduce customer impact", "Inspect cache hit rate and profile DB latency", "Freeze remediation plan", "Require senior approval", "Restore DB latency and pre-warm cache", "Verify wallet authorization probes"], riskClass: "R2", approvalRole: "senior_oncall", enabled: true },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export class OnboardingStore {
  private readonly apps = new Map<string, OnboardedApp>();

  constructor(private readonly path: string, private readonly now: () => Date = () => new Date()) {
    this.load();
    if (!this.apps.size) {
      const initial = seed(this.now().toISOString());
      this.apps.set(initial.id, initial);
      this.save();
    }
  }

  list(): OnboardedApp[] {
    return [...this.apps.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): OnboardedApp | undefined {
    return this.apps.get(id);
  }

  upsert(input: OnboardedAppInput): OnboardedApp {
    const validation = validateOnboarding(input);
    if (!validation.ok) throw new Error(validation.issues.join("; "));
    const existing = input.id ? this.apps.get(input.id) : undefined;
    const at = this.now().toISOString();
    const app: OnboardedApp = {
      ...input,
      id: input.id || `app_${randomUUID().slice(0, 8)}`,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    this.apps.set(app.id, app);
    this.save();
    return app;
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as { apps?: OnboardedApp[] };
      for (const app of parsed.apps ?? []) this.apps.set(app.id, app);
    } catch {
      // First start or invalid local state: seed a known-good registry below.
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, apps: this.list() }, null, 2));
    renameSync(temporary, this.path);
  }
}
