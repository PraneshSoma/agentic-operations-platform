import { describe, expect, it } from "vitest";
import type { ApplicationContext, ConnectorDescriptor, RequiredContextEntry } from "@aop/contracts";
import { ContextPackageSchema } from "@aop/contracts";
import { EnvVarSecretResolver } from "@aop/secrets";
import { SimulatedFixtureConnector } from "../fixtures/simulated-fixture-connector.js";
import { assembleContextPackage } from "./assemble-context-package.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const secretResolver = new EnvVarSecretResolver({ sim: "sk-fixture-secret" });

function connectorDescriptor(overrides: Partial<ConnectorDescriptor> = {}): ConnectorDescriptor {
  return {
    connector_id: "sim-app-context",
    tenant_id: "tenant_1",
    type: "api",
    operations: [{ name: "get_state", input_schema: {}, output_schema: {} }],
    authorization: { mode: "api_key", secret_ref: "secret://sim" },
    scopes: { environments: ["prod"], applications: ["checkout-service"] },
    staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" },
    definition_version: "1.0.0",
    supports_correlation: false,
    is_idempotent: false,
    reliability_level: "MEDIUM",
    ...overrides,
  };
}

const validApplicationContext: ApplicationContext = {
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
};

function requiredEntry(overrides: Partial<RequiredContextEntry> = {}): RequiredContextEntry {
  return {
    context_type: "application",
    connector_ref: "sim-app-context",
    operation: "get_state",
    required: true,
    timeout_ms: 5000,
    ...overrides,
  };
}

describe("assembleContextPackage — deps.now default", () => {
  it("uses the real wall clock when no `now` override is supplied", async () => {
    const before = Date.now();
    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [],
      connectorRegistry: new Map(),
    });
    const after = Date.now();
    const assembledAtMs = new Date(pkg.assembled_at).getTime();
    expect(assembledAtMs).toBeGreaterThanOrEqual(before);
    expect(assembledAtMs).toBeLessThanOrEqual(after);
  });
});

describe("assembleContextPackage", () => {
  it("assembles a schema-valid ContextPackage when every source resolves cleanly", async () => {
    const connector = new SimulatedFixtureConnector(
      connectorDescriptor(),
      new Map([["default", { data: validApplicationContext, retrievedAt: NOW }]]),
      secretResolver,
    );
    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [requiredEntry()],
      connectorRegistry: new Map([["sim-app-context", connector]]),
      now: NOW,
    });

    expect(ContextPackageSchema.safeParse(pkg).success).toBe(true);
    expect(pkg.application_context.application_id).toBe("checkout-service");
    expect(pkg.missing_context).toEqual([]);
    expect(pkg.stale_context).toEqual([]);
    expect(pkg.provenance).toHaveLength(1);
  });

  it("CRITICAL: missing_context populates when a fixture is configured as unavailable", async () => {
    const connector = new SimulatedFixtureConnector(connectorDescriptor(), new Map([["default", "unavailable"]]), secretResolver);
    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [requiredEntry({ required: true })],
      connectorRegistry: new Map([["sim-app-context", connector]]),
      now: NOW,
    });

    expect(pkg.missing_context).toHaveLength(1);
    expect(pkg.missing_context[0]).toMatchObject({ source: "sim-app-context", required: true });
    // The package is still schema-valid — application_context falls back
    // to a well-typed empty default, never omitted.
    expect(ContextPackageSchema.safeParse(pkg).success).toBe(true);
  });

  it("CRITICAL: stale_context populates when fixture data is older than staleness.max_age_seconds", async () => {
    const staleRetrievedAt = new Date(NOW.getTime() - 10 * 60 * 1000); // 10 minutes old
    const connector = new SimulatedFixtureConnector(
      connectorDescriptor({ staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" } }), // 5 min tolerance
      new Map([["default", { data: validApplicationContext, retrievedAt: staleRetrievedAt }]]),
      secretResolver,
    );
    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [requiredEntry()],
      connectorRegistry: new Map([["sim-app-context", connector]]),
      now: NOW,
    });

    expect(pkg.stale_context).toHaveLength(1);
    expect(pkg.stale_context[0]).toMatchObject({ source: "sim-app-context", max_age_seconds: 300 });
    expect(pkg.stale_context[0]?.age_seconds).toBeGreaterThan(300);
    // Stale data is still used — staleness is surfaced, not silently dropped (spec §9).
    expect(pkg.application_context.application_id).toBe("checkout-service");
  });

  it("data within the staleness tolerance is NOT marked stale", async () => {
    const freshRetrievedAt = new Date(NOW.getTime() - 60 * 1000); // 1 minute old, tolerance is 5 min
    const connector = new SimulatedFixtureConnector(
      connectorDescriptor({ staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" } }),
      new Map([["default", { data: validApplicationContext, retrievedAt: freshRetrievedAt }]]),
      secretResolver,
    );
    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [requiredEntry()],
      connectorRegistry: new Map([["sim-app-context", connector]]),
      now: NOW,
    });
    expect(pkg.stale_context).toEqual([]);
  });

  it("records missing_context when a required_context entry names an unregistered connector_ref", async () => {
    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [requiredEntry({ connector_ref: "never-registered" })],
      connectorRegistry: new Map(),
      now: NOW,
    });
    expect(pkg.missing_context).toEqual([{ source: "never-registered", reason: "connector not registered", required: true }]);
  });

  it("records missing_context (not a thrown error) when connector data fails schema validation for its declared context_type", async () => {
    const connector = new SimulatedFixtureConnector(
      connectorDescriptor(),
      new Map([["default", { data: { totally: "not an ApplicationContext" }, retrievedAt: NOW }]]),
      secretResolver,
    );
    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [requiredEntry()],
      connectorRegistry: new Map([["sim-app-context", connector]]),
      now: NOW,
    });
    expect(pkg.missing_context).toHaveLength(1);
    expect(pkg.missing_context[0]?.reason).toContain("failed ApplicationContext validation");
    expect(ContextPackageSchema.safeParse(pkg).success).toBe(true);
  });

  it("records missing_context when runtime connector data fails RuntimeContext validation", async () => {
    const connector = new SimulatedFixtureConnector(
      connectorDescriptor(),
      new Map([["default", { data: { not: "a runtime context" }, retrievedAt: NOW }]]),
      secretResolver,
    );
    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [requiredEntry({ context_type: "runtime" })],
      connectorRegistry: new Map([["sim-app-context", connector]]),
      now: NOW,
    });
    expect(pkg.missing_context[0]?.reason).toContain("failed RuntimeContext validation");
  });

  it("records missing_context when evidence connector data fails HistoricalEvidenceContext validation", async () => {
    const connector = new SimulatedFixtureConnector(
      connectorDescriptor(),
      new Map([["default", { data: { not: "a historical evidence context" }, retrievedAt: NOW }]]),
      secretResolver,
    );
    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [requiredEntry({ context_type: "evidence" })],
      connectorRegistry: new Map([["sim-app-context", connector]]),
      now: NOW,
    });
    expect(pkg.missing_context[0]?.reason).toContain("failed HistoricalEvidenceContext validation");
  });

  it("assembles runtime and evidence context types alongside application context in one package", async () => {
    const appConnector = new SimulatedFixtureConnector(
      connectorDescriptor({ connector_id: "sim-app" }),
      new Map([["default", { data: validApplicationContext, retrievedAt: NOW }]]),
      secretResolver,
    );
    const runtimeConnector = new SimulatedFixtureConnector(
      connectorDescriptor({ connector_id: "sim-runtime" }),
      new Map([
        [
          "default",
          {
            data: {
              time_window: { from: NOW.toISOString(), to: NOW.toISOString() },
              logs: { summaries: ["error rate elevated"], evidence_refs: [] },
              metrics: [{ metric: "error_rate", current: 0.2, anomaly: true }],
              traces: { summaries: [] },
              deployment_state: {},
            },
            retrievedAt: NOW,
          },
        ],
      ]),
      secretResolver,
    );
    const evidenceConnector = new SimulatedFixtureConnector(
      connectorDescriptor({ connector_id: "sim-evidence" }),
      new Map([
        [
          "default",
          {
            data: { similar_cases: [], aggregate: { precedent_count: 3, verified_success_count: 2, failure_count: 1, rollback_count: 0 } },
            retrievedAt: NOW,
          },
        ],
      ]),
      secretResolver,
    );

    const pkg = await assembleContextPackage({
      tenantId: "tenant_1",
      requestId: "req_1",
      executionId: "exec_1",
      opcId: "opc_1",
      requiredContext: [
        requiredEntry({ context_type: "application", connector_ref: "sim-app" }),
        requiredEntry({ context_type: "runtime", connector_ref: "sim-runtime" }),
        requiredEntry({ context_type: "evidence", connector_ref: "sim-evidence" }),
      ],
      connectorRegistry: new Map([
        ["sim-app", appConnector],
        ["sim-runtime", runtimeConnector],
        ["sim-evidence", evidenceConnector],
      ]),
      now: NOW,
    });

    expect(pkg.missing_context).toEqual([]);
    expect(pkg.runtime_context.metrics[0]?.anomaly).toBe(true);
    expect(pkg.historical_evidence.aggregate.precedent_count).toBe(3);
    expect(pkg.provenance).toHaveLength(3);
  });

  it("propagates a non-ContextUnavailableError thrown by a connector instead of swallowing it as missing_context", async () => {
    const throwingConnector = {
      descriptor: () => connectorDescriptor(),
      validateConfig: () => ({ valid: true, errors: [] }),
      executeRead: async () => {
        throw new Error("genuine connector bug, not a missing-data signal");
      },
    };
    await expect(
      assembleContextPackage({
        tenantId: "tenant_1",
        requestId: "req_1",
        executionId: "exec_1",
        opcId: "opc_1",
        requiredContext: [requiredEntry()],
        connectorRegistry: new Map([["sim-app-context", throwingConnector]]),
        now: NOW,
      }),
    ).rejects.toThrow(/genuine connector bug/);
  });
});
