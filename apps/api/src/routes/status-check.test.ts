import { describe, expect, it } from "vitest";
import type { ConnectorDescriptor, StatusCheckResult } from "@aop/contracts";
import type { ActionConnector, ValidationResult } from "@aop/action-executor";
import { buildApp } from "../app.js";

const descriptor: ConnectorDescriptor = {
  connector_id: "sim-action-connector",
  tenant_id: "tenant_1",
  type: "api",
  operations: [{ name: "restart", input_schema: {}, output_schema: {} }],
  authorization: { mode: "api_key", secret_ref: "secret://SIM_ACTION_KEY" },
  scopes: { environments: ["prod"], applications: ["checkout-service"] },
  staleness: { max_age_seconds: 300, on_exceeded: "MARK_STALE" },
  definition_version: "1.0.0",
  supports_correlation: false,
  is_idempotent: false,
  reliability_level: "MEDIUM",
};

/** A minimal fake connector whose statusCheck() echoes back a canned answer — proves the route delegates correctly, not the connector's own logic (covered in @aop/action-executor). */
class FakeConnector implements ActionConnector {
  constructor(private readonly result: StatusCheckResult) {}
  descriptor(): ConnectorDescriptor {
    return descriptor;
  }
  validateAction(): ValidationResult {
    return { valid: true, errors: [] };
  }
  async preflight(): Promise<never> {
    throw new Error("not used in this test");
  }
  async execute(): Promise<never> {
    throw new Error("not used in this test");
  }
  async statusCheck(): Promise<StatusCheckResult> {
    return this.result;
  }
}

describe("POST /internal/connectors/:connector_ref/status-check (LLD-v1 §6, story D-07)", () => {
  it("delegates to the registered connector's statusCheck() and returns its result", async () => {
    const connectorRegistry = new Map<string, ActionConnector>([
      ["sim-action-connector", new FakeConnector({ outcome: "CONFIRMED_EXECUTED", detail: "execution_result_id res_1" })],
    ]);
    const app = buildApp({ connectorRegistry });

    const response = await app.inject({
      method: "POST",
      url: "/internal/connectors/sim-action-connector/status-check",
      payload: { operation_id: "op_1", action_version: "1.0.0", connector_version: "1.0.0" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: "CONFIRMED_EXECUTED", detail: "execution_result_id res_1" });
  });

  it("returns 404 when connector_ref isn't registered", async () => {
    const app = buildApp({ connectorRegistry: new Map() });
    const response = await app.inject({
      method: "POST",
      url: "/internal/connectors/never_registered/status-check",
      payload: { operation_id: "op_1", action_version: "1.0.0", connector_version: "1.0.0" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for an invalid request body", async () => {
    const connectorRegistry = new Map<string, ActionConnector>([["sim-action-connector", new FakeConnector({ outcome: "INCONCLUSIVE" })]]);
    const app = buildApp({ connectorRegistry });
    const response = await app.inject({
      method: "POST",
      url: "/internal/connectors/sim-action-connector/status-check",
      payload: { operation_id: "op_1" }, // missing action_version, connector_version
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns an empty connector registry by default when none is provided", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/internal/connectors/anything/status-check",
      payload: { operation_id: "op_1", action_version: "1.0.0", connector_version: "1.0.0" },
    });
    expect(response.statusCode).toBe(404);
  });
});
