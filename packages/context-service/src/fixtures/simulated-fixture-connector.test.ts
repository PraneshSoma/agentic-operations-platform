import { describe, expect, it } from "vitest";
import type { ConnectorDescriptor } from "@aop/contracts";
import { ContextUnavailableError } from "../connector.js";
import { SimulatedFixtureConnector } from "./simulated-fixture-connector.js";

const descriptor: ConnectorDescriptor = {
  connector_id: "sim-app-context",
  tenant_id: "tenant_1",
  type: "api",
  operations: [{ name: "get_application_state", input_schema: {}, output_schema: {} }],
  authorization: { mode: "api_key", secret_ref: "secret://sim" },
  scopes: { environments: ["prod"], applications: ["checkout-service"] },
  staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" },
  definition_version: "1.0.0",
  supports_correlation: false,
  is_idempotent: false,
  reliability_level: "MEDIUM",
};

const execCtx = { tenantId: "tenant_1", requestId: "req_1", executionId: "exec_1" };

describe("SimulatedFixtureConnector", () => {
  it("returns fixture data with retrieved_at and a query_ref for a known key", async () => {
    const retrievedAt = new Date("2026-08-18T00:00:00.000Z");
    const connector = new SimulatedFixtureConnector(descriptor, new Map([["checkout-service", { data: { hello: "world" }, retrievedAt }]]));

    const result = await connector.executeRead("get_application_state", { key: "checkout-service" }, execCtx);
    expect(result.data).toEqual({ hello: "world" });
    expect(result.retrieved_at).toBe(retrievedAt.toISOString());
    expect(result.query_ref).toContain("sim-app-context");
  });

  it("CRITICAL: throws ContextUnavailableError for a key configured as \"unavailable\"", async () => {
    const connector = new SimulatedFixtureConnector(descriptor, new Map([["checkout-service", "unavailable"]]));
    await expect(connector.executeRead("get_application_state", { key: "checkout-service" }, execCtx)).rejects.toThrow(
      ContextUnavailableError,
    );
  });

  it("throws ContextUnavailableError for a key with no fixture entry at all", async () => {
    const connector = new SimulatedFixtureConnector(descriptor, new Map());
    await expect(connector.executeRead("get_application_state", { key: "never-configured" }, execCtx)).rejects.toThrow(
      ContextUnavailableError,
    );
  });

  it("falls back to key \"default\" when no key is provided on input", async () => {
    const retrievedAt = new Date("2026-08-18T00:00:00.000Z");
    const connector = new SimulatedFixtureConnector(descriptor, new Map([["default", { data: { x: 1 }, retrievedAt }]]));
    const result = await connector.executeRead("get_application_state", {}, execCtx);
    expect(result.data).toEqual({ x: 1 });
  });

  it("descriptor() returns exactly the ConnectorDescriptor passed at construction", () => {
    const connector = new SimulatedFixtureConnector(descriptor, new Map());
    expect(connector.descriptor()).toBe(descriptor);
  });

  it("validateConfig() always reports valid — no real external config to validate", () => {
    const connector = new SimulatedFixtureConnector(descriptor, new Map());
    expect(connector.validateConfig({})).toEqual({ valid: true, errors: [] });
  });

  it("NFR-02: exposes no write/mutate method on the instance — only descriptor/validateConfig/executeRead", () => {
    const connector = new SimulatedFixtureConnector(descriptor, new Map());
    const ownMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(connector)).filter((m) => m !== "constructor");
    expect(ownMethods.sort()).toEqual(["descriptor", "executeRead", "validateConfig"]);
  });
});
