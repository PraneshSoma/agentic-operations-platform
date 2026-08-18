import { randomUUID } from "node:crypto";
import {
  ApplicationContextSchema,
  ContextPackageSchema,
  HistoricalEvidenceContextSchema,
  RuntimeContextSchema,
  type ApplicationContext,
  type ContextPackage,
  type HistoricalEvidenceContext,
  type RequiredContextEntry,
  type RuntimeContext,
} from "@aop/contracts";
import { ContextUnavailableError, type ContextConnector } from "../connector.js";

export interface AssembleContextPackageInput {
  tenantId: string;
  requestId: string;
  executionId: string;
  opcId: string;
  requiredContext: readonly RequiredContextEntry[];
  /** connector_ref -> ContextConnector. Simulated in this story (B-04); real registry lands with real connectors. */
  connectorRegistry: ReadonlyMap<string, ContextConnector>;
  now?: Date;
}

function emptyApplicationContext(): ApplicationContext {
  return {
    application_id: "unknown",
    name: "unknown",
    owners: [],
    environments: [],
    dependencies: { upstream: [], downstream: [] },
    apis: [],
    datastores: [],
    messaging: [],
    slo_refs: [],
    approved_action_refs: [],
    change_context: {},
  };
}

function emptyRuntimeContext(now: Date): RuntimeContext {
  return {
    time_window: { from: now.toISOString(), to: now.toISOString() },
    logs: { summaries: [], evidence_refs: [] },
    metrics: [],
    traces: { summaries: [] },
    deployment_state: {},
  };
}

function emptyHistoricalEvidenceContext(): HistoricalEvidenceContext {
  return {
    similar_cases: [],
    aggregate: { precedent_count: 0, verified_success_count: 0, failure_count: 0, rollback_count: 0 },
  };
}

/**
 * assembleContextPackage — spec §8-9's Context Service, story B-04. Reads
 * every entry in required_context via the injected connector registry and
 * builds a single, schema-valid ContextPackage.
 *
 * ContextPackage's three context sub-objects are non-optional per its
 * ACCEPTED Zod schema (packages/contracts) — when a source is missing or
 * fails validation, the corresponding field falls back to a well-typed
 * empty default rather than being omitted, and the gap is recorded
 * explicitly in missing_context instead (spec §9's own design constraint:
 * "stale context is marked" — the package is never silently incomplete).
 */
export async function assembleContextPackage(input: AssembleContextPackageInput): Promise<ContextPackage> {
  const now = input.now ?? new Date();

  const missing_context: { source: string; reason: string; required: boolean }[] = [];
  const stale_context: { source: string; age_seconds: number; max_age_seconds: number }[] = [];
  const provenance: { connector_ref: string; query_ref: string; retrieved_at: string }[] = [];

  let application_context = emptyApplicationContext();
  let runtime_context = emptyRuntimeContext(now);
  let historical_evidence = emptyHistoricalEvidenceContext();

  for (const entry of input.requiredContext) {
    const connector = input.connectorRegistry.get(entry.connector_ref);
    if (!connector) {
      missing_context.push({ source: entry.connector_ref, reason: "connector not registered", required: entry.required });
      continue;
    }

    let result;
    try {
      result = await connector.executeRead(entry.operation, {}, {
        tenantId: input.tenantId,
        requestId: input.requestId,
        executionId: input.executionId,
      });
    } catch (err) {
      if (err instanceof ContextUnavailableError) {
        missing_context.push({ source: entry.connector_ref, reason: err.message, required: entry.required });
        continue;
      }
      throw err;
    }

    const ageSeconds = Math.max(0, (now.getTime() - new Date(result.retrieved_at).getTime()) / 1000);
    const maxAgeSeconds = connector.descriptor().staleness.max_age_seconds;
    if (ageSeconds > maxAgeSeconds) {
      stale_context.push({ source: entry.connector_ref, age_seconds: Math.round(ageSeconds), max_age_seconds: maxAgeSeconds });
    }

    provenance.push({ connector_ref: entry.connector_ref, query_ref: result.query_ref, retrieved_at: result.retrieved_at });

    switch (entry.context_type) {
      case "application": {
        const parsed = ApplicationContextSchema.safeParse(result.data);
        if (parsed.success) application_context = parsed.data;
        else missing_context.push({ source: entry.connector_ref, reason: "connector data failed ApplicationContext validation", required: entry.required });
        break;
      }
      case "runtime": {
        const parsed = RuntimeContextSchema.safeParse(result.data);
        if (parsed.success) runtime_context = parsed.data;
        else missing_context.push({ source: entry.connector_ref, reason: "connector data failed RuntimeContext validation", required: entry.required });
        break;
      }
      case "evidence": {
        const parsed = HistoricalEvidenceContextSchema.safeParse(result.data);
        if (parsed.success) historical_evidence = parsed.data;
        else missing_context.push({ source: entry.connector_ref, reason: "connector data failed HistoricalEvidenceContext validation", required: entry.required });
        break;
      }
    }
  }

  return ContextPackageSchema.parse({
    context_package_id: randomUUID(),
    tenant_id: input.tenantId,
    request_id: input.requestId,
    opc_id: input.opcId,
    assembled_at: now.toISOString(),
    application_context,
    runtime_context,
    historical_evidence,
    missing_context,
    stale_context,
    provenance,
  });
}
