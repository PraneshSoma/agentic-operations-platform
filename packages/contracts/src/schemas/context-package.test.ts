import { describe, expect, it } from "vitest";
import { ContextPackageSchema } from "./context-package.js";

const validPayload = {
  context_package_id: "ctx_1",
  tenant_id: "tenant_abc",
  request_id: "req_1",
  opc_id: "opc_a",
  assembled_at: "2026-08-17T00:00:00.000Z",
  application_context: {
    application_id: "checkout-service",
    name: "Checkout Service",
    owners: ["team-checkout"],
    environments: ["prod"],
    dependencies: { upstream: [], downstream: [] },
    apis: [],
    datastores: [],
    messaging: [],
    slo_refs: [],
    approved_action_refs: [],
    change_context: {},
  },
  runtime_context: {
    time_window: { from: "2026-08-17T00:00:00.000Z", to: "2026-08-17T01:00:00.000Z" },
    logs: { summaries: [], evidence_refs: [] },
    metrics: [{ metric: "5xx_rate", current: 0.15, anomaly: true }],
    traces: { summaries: [] },
    deployment_state: {},
  },
  historical_evidence: {
    similar_cases: [],
    aggregate: { precedent_count: 0, verified_success_count: 0, failure_count: 0, rollback_count: 0 },
  },
  missing_context: [],
  stale_context: [],
  provenance: [],
};

describe("ContextPackageSchema", () => {
  it("accepts a valid payload matching spec §8-9's shape, including stale_context (§10)", () => {
    expect(ContextPackageSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts a populated stale_context entry", () => {
    const withStale = {
      ...validPayload,
      stale_context: [{ source: "logs-connector", age_seconds: 900, max_age_seconds: 300 }],
    };
    expect(ContextPackageSchema.safeParse(withStale).success).toBe(true);
  });

  it("accepts a required missing_context entry (required context that couldn't be assembled)", () => {
    const withMissing = {
      ...validPayload,
      missing_context: [{ source: "app-catalog", reason: "connector timeout", required: true }],
    };
    expect(ContextPackageSchema.safeParse(withMissing).success).toBe(true);
  });

  it("rejects a metrics entry missing the required 'anomaly' field", () => {
    const broken = {
      ...validPayload,
      runtime_context: {
        ...validPayload.runtime_context,
        metrics: [{ metric: "5xx_rate", current: 0.15 }],
      },
    };
    expect(ContextPackageSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a messaging entry with an out-of-enum type", () => {
    const broken = {
      ...validPayload,
      application_context: {
        ...validPayload.application_context,
        messaging: [{ name: "orders", type: "carrier_pigeon" }],
      },
    };
    expect(ContextPackageSchema.safeParse(broken).success).toBe(false);
  });
});
