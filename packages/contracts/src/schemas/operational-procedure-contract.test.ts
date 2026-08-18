import { describe, expect, it } from "vitest";
import { OperationalProcedureContractSchema } from "./operational-procedure-contract.js";

function omit<T extends object>(obj: T, path: string): T {
  const clone = structuredClone(obj);
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = clone;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]!];
  delete cur[parts[parts.length - 1]!];
  return clone;
}

const validPayload = {
  opc_id: "opc_a",
  version: "1.0.0",
  tenant_id: "tenant_abc",
  name: "Data Reconciliation",
  status: "published",
  match: {
    categories: ["reconciliation"],
    applications: ["checkout-service"],
    severities: ["high", "medium"],
    semantic_description: "Application vs runtime state mismatch",
  },
  required_context: [
    { context_type: "application", connector_ref: "app-catalog", operation: "get", required: true, timeout_ms: 3000 },
  ],
  investigation: { objective: "Diagnose mismatch", required_checks: ["compare_state"], max_hypotheses: 3 },
  actions: { allowed_action_refs: ["reconcile_action"] },
  verification: {
    checks: [{ name: "parity_check", connector_ref: "app-catalog", operation: "compare", success_condition: "diff == 0" }],
  },
  escalation: { conditions: [{ type: "budget_exceeded", threshold: 100000 }] },
  rollback: { required_for_risk_levels: ["R2", "R3"], action_ref: "reconcile_rollback" },
  timeout: { investigation_minutes: 15, approval_minutes: 30, execution_minutes: 10 },
  budget: {
    max_investigation_tokens: 30000,
    max_planning_tokens: 20000,
    max_tool_calls: 20,
    max_wall_clock_minutes: 30,
    on_exceeded: "ESCALATE",
  },
};

describe("OperationalProcedureContractSchema", () => {
  it("accepts a valid payload matching spec §4.2's shape (OPC A shape from §35)", () => {
    expect(OperationalProcedureContractSchema.safeParse(validPayload).success).toBe(true);
  });

  it("defaults budget.on_exceeded to ESCALATE when omitted (spec §4.2 default)", () => {
    const withoutOnExceeded = omit(validPayload, "budget.on_exceeded");
    const parsed = OperationalProcedureContractSchema.parse(withoutOnExceeded);
    expect(parsed.budget.on_exceeded).toBe("ESCALATE");
  });

  it.each([
    "opc_id",
    "version",
    "tenant_id",
    "name",
    "status",
    "match.categories",
    "match.applications",
    "match.severities",
    "required_context",
    "investigation.objective",
    "investigation.required_checks",
    "investigation.max_hypotheses",
    "actions.allowed_action_refs",
    "verification.checks",
    "escalation.conditions",
    "rollback.required_for_risk_levels",
    "timeout.investigation_minutes",
    "timeout.approval_minutes",
    "timeout.execution_minutes",
    "budget.max_investigation_tokens",
    "budget.max_planning_tokens",
    "budget.max_tool_calls",
    "budget.max_wall_clock_minutes",
  ])("rejects a payload missing required field %s", (path) => {
    expect(OperationalProcedureContractSchema.safeParse(omit(validPayload, path)).success).toBe(false);
  });

  it("CRITICAL: rejects an out-of-enum status value — must not silently accept an unpublished OPC as active (spec §3.1: published versions are immutable)", () => {
    const broken = { ...validPayload, status: "half_baked" };
    expect(OperationalProcedureContractSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a rollback.required_for_risk_levels value outside [R2, R3]", () => {
    const broken = { ...validPayload, rollback: { ...validPayload.rollback, required_for_risk_levels: ["R0"] } };
    expect(OperationalProcedureContractSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects budget.on_exceeded outside [ESCALATE, STOP_AND_SUMMARIZE] (spec §7B)", () => {
    const broken = { ...validPayload, budget: { ...validPayload.budget, on_exceeded: "IGNORE" } };
    expect(OperationalProcedureContractSchema.safeParse(broken).success).toBe(false);
  });
});
