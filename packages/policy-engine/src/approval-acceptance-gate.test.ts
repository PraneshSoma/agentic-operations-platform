import { describe, expect, it } from "vitest";
import type { PolicyDecision, ProposedAction } from "@aop/contracts";
import { LocalDevIdentityResolver } from "@aop/identity";
import { runApprovalAcceptanceGate, type ApprovalAcceptanceGateInput } from "./approval-acceptance-gate.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");

const proposedAction: ProposedAction = {
  proposal_id: "prop_1",
  request_id: "req_1",
  execution_id: "exec_1",
  tenant_id: "tenant_1",
  action_ref: "restart_service",
  action_version: "1.0.0",
  reason: "recover from error spike",
  parameters: {},
  expected_outcome: "service healthy",
  risk_assessment: { requested_risk_class: "R2", blast_radius: { scope: "service" }, reversible: true },
  supporting_evidence_ids: [],
  generated_by: { agent: "investigator", model: "sim", prompt_version: "1" },
  accountable_principal_id: "user_proposer",
  created_at: NOW.toISOString(),
};

function policyDecision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    decision_id: "dec_1",
    proposal_id: "prop_1",
    policy_version: "v1",
    effective_risk_class: "R2",
    outcome: "REQUIRE_APPROVAL",
    reasons: [],
    evidence_summary: { precedent_count: 0, verified_success_count: 0, rollback_count: 0, failure_count: 0 },
    requires_proposer_approver_separation: false,
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

const identityResolver = new LocalDevIdentityResolver([
  { id: "user_proposer", tenant_id: "tenant_1", display_name: "Proposer", roles: ["operator", "senior_oncall"] },
  { id: "user_approver", tenant_id: "tenant_1", display_name: "Approver", roles: ["senior_oncall"] },
  { id: "user_low_permission", tenant_id: "tenant_1", display_name: "Low Permission", roles: ["operator"] },
]);

function baseInput(overrides: Partial<ApprovalAcceptanceGateInput> = {}): ApprovalAcceptanceGateInput {
  return {
    tenantId: "tenant_1",
    policyDecision: policyDecision(),
    proposedAction,
    decision: "APPROVED",
    actorId: "user_approver",
    identityResolver,
    now: NOW,
    authorizationId: "auth_1",
    signedPlanHash: "sha256:x",
    issuedBy: "approval-acceptance-gate",
    ...overrides,
  };
}

describe("runApprovalAcceptanceGate — LLD-v1 §5's corrected sequence", () => {
  it("issues an ExecutionAuthorization when every check passes", async () => {
    const result = await runApprovalAcceptanceGate(baseInput());
    expect(result.outcome).toBe("AUTHORIZED");
    if (result.outcome === "AUTHORIZED") {
      expect(result.authorization.identity.mode).toBe("ON_BEHALF_OF");
      expect(result.authorization.identity.approver_ref).toBe("user_approver");
      expect(result.authorization.identity.requester_ref).toBe("user_proposer");
      expect(result.authorization.proposal_id).toBe("prop_1");
      expect(result.authorization.policy_decision_id).toBe("dec_1");
    }
  });

  it("CRITICAL: resolves the approver's identity AFTER PolicyDecision exists — rejects when the PolicyDecision outcome isn't REQUIRE_APPROVAL", async () => {
    const result = await runApprovalAcceptanceGate(baseInput({ policyDecision: policyDecision({ outcome: "ALLOW" }) }));
    expect(result.outcome).toBe("REJECTED");
  });

  it("rejects when the submitted decision is not APPROVED", async () => {
    const result = await runApprovalAcceptanceGate(baseInput({ decision: "REJECTED" }));
    expect(result.outcome).toBe("REJECTED");
  });

  it("CRITICAL: rejects when the actor cannot be resolved to a known identity", async () => {
    const result = await runApprovalAcceptanceGate(baseInput({ actorId: "user_never_configured" }));
    expect(result.outcome).toBe("REJECTED");
    if (result.outcome === "REJECTED") expect(result.reason).toContain("Could not resolve");
  });

  it("CRITICAL: rejects when the resolved approver's roles do not permit the risk class being approved", async () => {
    const result = await runApprovalAcceptanceGate(
      baseInput({ actorId: "user_low_permission", policyDecision: policyDecision({ effective_risk_class: "R2" }) }),
    );
    expect(result.outcome).toBe("REJECTED");
    if (result.outcome === "REJECTED") expect(result.reason).toContain("do not permit");
  });

  describe("separation of duties (LLD-v1 §5's corrected flow)", () => {
    it("CRITICAL: rejects when requires_proposer_approver_separation is true AND approver == accountable_principal", async () => {
      const result = await runApprovalAcceptanceGate(
        baseInput({
          actorId: "user_proposer", // same principal who proposed the action
          policyDecision: policyDecision({ requires_proposer_approver_separation: true }),
        }),
      );
      expect(result.outcome).toBe("REJECTED");
      if (result.outcome === "REJECTED") expect(result.reason).toContain("Separation of duties");
    });

    it("authorizes when requires_proposer_approver_separation is true AND approver != accountable_principal", async () => {
      const result = await runApprovalAcceptanceGate(
        baseInput({
          actorId: "user_approver", // different principal
          policyDecision: policyDecision({ requires_proposer_approver_separation: true }),
        }),
      );
      expect(result.outcome).toBe("AUTHORIZED");
    });

    it("does NOT check separation when requires_proposer_approver_separation is false, even if approver == accountable_principal", async () => {
      const result = await runApprovalAcceptanceGate(
        baseInput({
          actorId: "user_proposer",
          policyDecision: policyDecision({ requires_proposer_approver_separation: false }),
        }),
      );
      expect(result.outcome).toBe("AUTHORIZED");
    });
  });

  it("CRITICAL: no ExecutionAuthorization is issued on any rejection path — only 'AUTHORIZED' results carry one", async () => {
    const rejectedResults = await Promise.all([
      runApprovalAcceptanceGate(baseInput({ policyDecision: policyDecision({ outcome: "DENY" }) })),
      runApprovalAcceptanceGate(baseInput({ decision: "EXPIRED" })),
      runApprovalAcceptanceGate(baseInput({ actorId: "unknown" })),
      runApprovalAcceptanceGate(baseInput({ actorId: "user_low_permission" })),
      runApprovalAcceptanceGate(
        baseInput({ actorId: "user_proposer", policyDecision: policyDecision({ requires_proposer_approver_separation: true }) }),
      ),
    ]);
    for (const result of rejectedResults) {
      expect(result.outcome).toBe("REJECTED");
      expect("authorization" in result).toBe(false);
    }
  });

  it("defaults the delegation token TTL to 15 minutes", async () => {
    const result = await runApprovalAcceptanceGate(baseInput());
    if (result.outcome === "AUTHORIZED") {
      const issuedAt = new Date(result.authorization.delegation.issued_at).getTime();
      const expiresAt = new Date(result.authorization.delegation.expires_at).getTime();
      expect(expiresAt - issuedAt).toBe(15 * 60 * 1000);
    }
  });

  it("honors an explicit tokenTtlMinutes override", async () => {
    const result = await runApprovalAcceptanceGate(baseInput({ tokenTtlMinutes: 5 }));
    if (result.outcome === "AUTHORIZED") {
      const issuedAt = new Date(result.authorization.delegation.issued_at).getTime();
      const expiresAt = new Date(result.authorization.delegation.expires_at).getTime();
      expect(expiresAt - issuedAt).toBe(5 * 60 * 1000);
    }
  });
});
