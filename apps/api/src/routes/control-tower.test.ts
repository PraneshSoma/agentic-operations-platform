import { describe, expect, it } from "vitest";
import type { ControlTowerRepository, EngineeringContextPackageView, ExecutionHistory, VersionBindingView } from "@aop/evidence-ledger";
import { buildApp } from "../app.js";

const history: ExecutionHistory = {
  tenant_id: "tenant_1",
  execution_id: "exec_1",
  entries: [{ sequence: 1, occurred_at: "2026-08-18T12:00:00.000Z", evidence_type: "REQUEST", summary: "received", evidence_id: "ev_1", supersedes: undefined }],
};

const versionBinding: VersionBindingView = {
  tenant_id: "tenant_1", execution_id: "exec_1", opc_id: "opc_1", opc_version: "1.0.0",
  action_bindings: [{ action_ref: "restart_service", action_version: "1.0.0" }], policy_versions: ["v1"],
  frozen_plan_ids: [], approval_ids: [], model_bindings: [], connector_definition_versions: [], executor_build_hashes: [],
  evidence_snapshot_reconstructable: true,
};

/** In-memory fake — proves the route delegates + tenant-scopes correctly (the real Prisma impl is integration-tested). */
class FakeControlTowerRepository implements ControlTowerRepository {
  constructor(private readonly known: { tenantId: string; executionId: string }) {}
  private knows(tenantId: string, executionId: string): boolean {
    return tenantId === this.known.tenantId && executionId === this.known.executionId;
  }
  async getCompositeContextPackage(tenantId: string, executionId: string): Promise<EngineeringContextPackageView | undefined> {
    if (!this.knows(tenantId, executionId)) return undefined;
    return { tenant_id: tenantId, execution_id: executionId, execution: {} as never, context_package: null, proposed_actions: [], policy_decisions: [], verifications: [], history };
  }
  async reconstructExecutionHistory(tenantId: string, executionId: string): Promise<ExecutionHistory | undefined> {
    if (!this.knows(tenantId, executionId)) return undefined;
    return history;
  }
  async getVersionBinding(tenantId: string, executionId: string): Promise<VersionBindingView | undefined> {
    if (!this.knows(tenantId, executionId)) return undefined;
    return versionBinding;
  }
}

function app() {
  return buildApp({ controlTowerRepository: new FakeControlTowerRepository({ tenantId: "tenant_1", executionId: "exec_1" }) });
}

describe("GET .../context-package/composite (E-05, OI-REQ-02)", () => {
  it("returns 200 with the composite view for a known execution", async () => {
    const response = await app().inject({ method: "GET", url: "/tenants/tenant_1/executions/exec_1/context-package/composite" });
    expect(response.statusCode).toBe(200);
    expect(response.json().execution_id).toBe("exec_1");
    expect(response.json().history.entries).toHaveLength(1);
  });

  it("returns 404 for an unknown execution", async () => {
    const response = await app().inject({ method: "GET", url: "/tenants/tenant_1/executions/never/context-package/composite" });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for the wrong tenant even when the execution id exists — never another tenant's data", async () => {
    const response = await app().inject({ method: "GET", url: "/tenants/other_tenant/executions/exec_1/context-package/composite" });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET .../history (E-05, F-16)", () => {
  it("returns 200 with the reconstructed history for a known execution", async () => {
    const response = await app().inject({ method: "GET", url: "/tenants/tenant_1/executions/exec_1/history" });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries[0].summary).toBe("received");
  });

  it("returns 404 for an unknown execution", async () => {
    const response = await app().inject({ method: "GET", url: "/tenants/tenant_1/executions/never/history" });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET .../version-binding (E-06, F-20)", () => {
  it("returns 200 with the version binding for a known execution", async () => {
    const response = await app().inject({ method: "GET", url: "/tenants/tenant_1/executions/exec_1/version-binding" });
    expect(response.statusCode).toBe(200);
    expect(response.json().opc_version).toBe("1.0.0");
    expect(response.json().evidence_snapshot_reconstructable).toBe(true);
  });

  it("returns 404 for the wrong tenant even when the execution id exists", async () => {
    const response = await app().inject({ method: "GET", url: "/tenants/other/executions/exec_1/version-binding" });
    expect(response.statusCode).toBe(404);
  });
});

describe("control-tower routes are not registered when no repository is provided", () => {
  it("returns 404 for the composite route on an app built without a controlTowerRepository", async () => {
    const response = await buildApp().inject({ method: "GET", url: "/tenants/tenant_1/executions/exec_1/context-package/composite" });
    expect(response.statusCode).toBe(404);
  });
});
