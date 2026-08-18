import { describe, expect, it } from "vitest";
import type { IncomingRequest, OperationalProcedureContract } from "@aop/contracts";
import { TextOverlapSemanticMatcher } from "./semantic-matcher.js";

function request(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    request_id: "req_1",
    tenant_id: "tenant_1",
    source: { type: "webhook", source_id: "s", source_reference: "r" },
    received_at: "2026-08-18T00:00:00.000Z",
    requester: { id: "u1", roles: [] },
    subject: "Checkout service error rate spike",
    description: "Errors climbing on checkout-service since deploy",
    labels: {},
    raw_payload_ref: "ref_1",
    correlation: {},
    ...overrides,
  };
}

function opc(overrides: Partial<OperationalProcedureContract> = {}): OperationalProcedureContract {
  return {
    opc_id: "opc_1",
    version: "1.0.0",
    tenant_id: "tenant_1",
    name: "Production Error Spike",
    status: "published",
    match: { categories: [], applications: [], severities: [], semantic_description: "error rate spike checkout" },
    required_context: [],
    investigation: { objective: "isolate", required_checks: [], max_hypotheses: 3 },
    actions: { allowed_action_refs: [] },
    verification: { checks: [] },
    escalation: { conditions: [] },
    rollback: { required_for_risk_levels: [] },
    timeout: { investigation_minutes: 10, approval_minutes: 10, execution_minutes: 10 },
    budget: { max_investigation_tokens: 1, max_planning_tokens: 1, max_tool_calls: 1, max_wall_clock_minutes: 1, on_exceeded: "ESCALATE" },
    ...overrides,
  };
}

describe("TextOverlapSemanticMatcher", () => {
  const matcher = new TextOverlapSemanticMatcher();

  it("scores high overlap between clearly related text near 1", () => {
    const score = matcher.score(
      request({ subject: "error rate spike", description: "checkout" }),
      opc({ name: "error rate spike", match: { categories: [], applications: [], severities: [], semantic_description: "checkout" } }),
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it("scores completely unrelated text at 0", () => {
    const score = matcher.score(
      request({ subject: "billing reconciliation mismatch", description: "invoice totals differ" }),
      opc({ name: "zzz qqq xxx", match: { categories: [], applications: [], severities: [], semantic_description: "yyy www" } }),
    );
    expect(score).toBe(0);
  });

  it("never returns a score outside [0, 1]", () => {
    const score = matcher.score(request(), opc());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns 0 when the request has no meaningful text (empty subject/description)", () => {
    const score = matcher.score(request({ subject: "", description: "" }), opc());
    expect(score).toBe(0);
  });

  it("returns 0 when the OPC has no semantic_description and an unrelated name", () => {
    const score = matcher.score(
      request(),
      opc({ name: "qqqzzz", match: { categories: [], applications: [], severities: [] } }),
    );
    expect(score).toBe(0);
  });
});
