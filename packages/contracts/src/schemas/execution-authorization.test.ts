import { describe, expect, it } from "vitest";
import { ExecutionAuthorizationSchema } from "./execution-authorization.js";

const validPayload = {
  authorization_id: "auth_1",
  proposal_id: "prop_1",
  policy_decision_id: "dec_1",
  identity: {
    mode: "SERVICE_ACCOUNT",
    acting_as: { id: "svc_platform", type: "platform_service_account" },
  },
  delegation: {
    token_type: "none",
    scopes: [],
    issued_at: "2026-08-17T00:00:00.000Z",
    expires_at: "2026-08-17T00:10:00.000Z",
  },
  signed_plan_hash: "sha256:abc",
  issued_by: "policy-engine",
  created_at: "2026-08-17T00:00:00.000Z",
};

describe("ExecutionAuthorizationSchema", () => {
  it("accepts a valid SERVICE_ACCOUNT payload matching spec §14A's shape", () => {
    expect(ExecutionAuthorizationSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts a valid ON_BEHALF_OF payload with approver_ref set", () => {
    const obo = {
      ...validPayload,
      identity: {
        mode: "ON_BEHALF_OF",
        acting_as: { id: "user_1", type: "human" },
        approver_ref: "approval_1",
        requester_ref: "req_1",
      },
      delegation: { ...validPayload.delegation, token_type: "obo", token_ref: "secret://obo-token-1" },
    };
    expect(ExecutionAuthorizationSchema.safeParse(obo).success).toBe(true);
  });

  it("CRITICAL: rejects an out-of-enum identity.mode value — only SERVICE_ACCOUNT or ON_BEHALF_OF may authorize an execution (spec §14A)", () => {
    const broken = { ...validPayload, identity: { ...validPayload.identity, mode: "TRUST_ME_BRO" } };
    expect(ExecutionAuthorizationSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum acting_as.type value", () => {
    const broken = {
      ...validPayload,
      identity: { ...validPayload.identity, acting_as: { id: "x", type: "robot" } },
    };
    expect(ExecutionAuthorizationSchema.safeParse(broken).success).toBe(false);
  });
});
