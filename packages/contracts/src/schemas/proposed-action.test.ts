import { describe, expect, it } from "vitest";
import { ProposedActionSchema } from "./proposed-action.js";

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
  proposal_id: "prop_1",
  request_id: "req_1",
  execution_id: "exec_1",
  tenant_id: "tenant_abc",
  action_ref: "restart_service",
  action_version: "1.0.0",
  reason: "Restart clears the elevated timeout condition",
  parameters: { service: "checkout-service" },
  expected_outcome: "5xx rate returns to baseline",
  risk_assessment: {
    requested_risk_class: "R1",
    blast_radius: {
      scope: "service",
      estimated_entities: 1,
      environmental_criticality: "medium",
      compensation_class: "REVERSIBLE",
      data_sensitivity: "none",
      customer_exposure: "internal",
    },
    reversible: true,
  },
  supporting_evidence_ids: ["ev_1", "ev_2"],
  generated_by: { agent: "investigator", model: "claude-sonnet-5", prompt_version: "v1" },
  accountable_principal_id: "principal_1",
  created_at: "2026-08-17T00:00:00.000Z",
};

describe("ProposedActionSchema", () => {
  it("accepts a valid payload matching spec §4.3's shape, including the 5-component blast_radius (LLD-v1 §2, ADR-003)", () => {
    expect(ProposedActionSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts a payload where all five additive blast_radius components are omitted (they're optional per ADR-003's note that not every action kind populates them yet)", () => {
    const minimal = {
      ...validPayload,
      risk_assessment: {
        ...validPayload.risk_assessment,
        blast_radius: { scope: "service" },
      },
    };
    expect(ProposedActionSchema.safeParse(minimal).success).toBe(true);
  });

  it.each([
    "proposal_id",
    "request_id",
    "execution_id",
    "tenant_id",
    "action_ref",
    "action_version",
    "reason",
    "parameters",
    "expected_outcome",
    "risk_assessment.requested_risk_class",
    "risk_assessment.blast_radius.scope",
    "risk_assessment.reversible",
    "supporting_evidence_ids",
    "generated_by.agent",
    "generated_by.model",
    "generated_by.prompt_version",
    "accountable_principal_id",
    "created_at",
  ])("rejects a payload missing required field %s", (path) => {
    expect(ProposedActionSchema.safeParse(omit(validPayload, path)).success).toBe(false);
  });

  it("CRITICAL: rejects an out-of-enum requested_risk_class value — the Policy Engine's risk routing (spec §15-16) depends on this being one of exactly R0-R3", () => {
    const broken = {
      ...validPayload,
      risk_assessment: { ...validPayload.risk_assessment, requested_risk_class: "R4" },
    };
    expect(ProposedActionSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum compensation_class value (ADR-001's three-class model, reused here per ADR-003)", () => {
    const broken = {
      ...validPayload,
      risk_assessment: {
        ...validPayload.risk_assessment,
        blast_radius: { ...validPayload.risk_assessment.blast_radius, compensation_class: "MOSTLY_FINE" },
      },
    };
    expect(ProposedActionSchema.safeParse(broken).success).toBe(false);
  });

  it("keeps accountable_principal_id distinct from generated_by.agent — attribution of a human/system principal is not the same field as which AI agent generated the proposal (LLD-v1 §5)", () => {
    const parsed = ProposedActionSchema.parse(validPayload);
    expect(parsed.accountable_principal_id).not.toBe(parsed.generated_by.agent);
  });
});
