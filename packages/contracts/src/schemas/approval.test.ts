import { describe, expect, it } from "vitest";
import { ApprovalDecisionSchema, ApprovalRequestSchema } from "./approval.js";

const validRequest = {
  approval_id: "appr_1",
  tenant_id: "tenant_1",
  request_id: "req_1",
  plan_id: "plan_1",
  proposal_id: "prop_1",
  approver_route: "senior_oncall",
  summary: {
    diagnosis: "deploy-induced error spike",
    proposed_action: "restart the service",
    expected_outcome: "error rate returns to baseline",
    blast_radius: "single service, prod",
    rollback: "redeploy previous version",
  },
  supporting_evidence_ids: ["ev_1"],
  expires_at: "2026-08-18T01:00:00.000Z",
};

const validDecision = {
  approval_id: "appr_1",
  decision: "APPROVED",
  actor: { id: "user_1", role: "senior_oncall" },
  comment: "looks good",
  decided_at: "2026-08-18T00:30:00.000Z",
};

describe("ApprovalRequestSchema", () => {
  it("accepts a valid payload matching spec §18's shape", () => {
    expect(ApprovalRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it.each(["approval_id", "tenant_id", "request_id", "plan_id", "proposal_id", "approver_route", "summary", "supporting_evidence_ids", "expires_at"])(
    "rejects when required field %s is missing",
    (field) => {
      const broken = structuredClone(validRequest) as Record<string, unknown>;
      delete broken[field];
      expect(ApprovalRequestSchema.safeParse(broken).success).toBe(false);
    },
  );
});

describe("ApprovalDecisionSchema", () => {
  it("accepts a valid APPROVED payload matching spec §18's shape", () => {
    expect(ApprovalDecisionSchema.safeParse(validDecision).success).toBe(true);
  });

  it.each(["APPROVED", "REJECTED", "REQUEST_CHANGES", "EXPIRED"])("accepts decision %s", (decision) => {
    expect(ApprovalDecisionSchema.safeParse({ ...validDecision, decision }).success).toBe(true);
  });

  it("accepts an omitted comment", () => {
    const { comment: _omit, ...withoutComment } = validDecision;
    expect(ApprovalDecisionSchema.safeParse(withoutComment).success).toBe(true);
  });

  it("rejects an out-of-enum decision value", () => {
    expect(ApprovalDecisionSchema.safeParse({ ...validDecision, decision: "MAYBE" }).success).toBe(false);
  });

  it.each(["approval_id", "decision", "actor", "decided_at"])("rejects when required field %s is missing", (field) => {
    const broken = structuredClone(validDecision) as Record<string, unknown>;
    delete broken[field];
    expect(ApprovalDecisionSchema.safeParse(broken).success).toBe(false);
  });
});
