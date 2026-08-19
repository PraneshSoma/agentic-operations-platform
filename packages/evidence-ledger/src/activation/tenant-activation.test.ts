import { describe, expect, it } from "vitest";
import { evaluateActivation } from "./tenant-activation.js";

describe("evaluateActivation() — the unified tenant activation gate (E-07, ADR-011 + ADR-012)", () => {
  it("READY when retention is confirmed AND no development principals are present", () => {
    expect(evaluateActivation({ retentionPolicyConfirmedAt: "2026-08-18T12:00:00.000Z", developmentPrincipalIds: [] })).toEqual({ outcome: "READY" });
  });

  it("CRITICAL: REJECTED when retention_policy_confirmed_at is not set (ADR-011)", () => {
    const decision = evaluateActivation({ retentionPolicyConfirmedAt: null, developmentPrincipalIds: [] });
    expect(decision.outcome).toBe("REJECTED");
    if (decision.outcome !== "REJECTED") return;
    expect(decision.reasons).toContainEqual({ code: "RETENTION_POLICY_NOT_CONFIRMED" });
  });

  it("treats undefined retention the same as null — REJECTED", () => {
    const decision = evaluateActivation({ retentionPolicyConfirmedAt: undefined, developmentPrincipalIds: [] });
    expect(decision.outcome).toBe("REJECTED");
  });

  it("CRITICAL: REJECTED when any development principal is present, listing the offending ids (ADR-012)", () => {
    const decision = evaluateActivation({ retentionPolicyConfirmedAt: "2026-08-18T12:00:00.000Z", developmentPrincipalIds: ["dev_b", "dev_a"] });
    expect(decision.outcome).toBe("REJECTED");
    if (decision.outcome !== "REJECTED") return;
    expect(decision.reasons).toContainEqual({ code: "DEVELOPMENT_PRINCIPAL_IN_PATH", development_principal_ids: ["dev_a", "dev_b"] });
  });

  it("CRITICAL: reports BOTH reasons when both conditions fail — fail-closed, no partial activation", () => {
    const decision = evaluateActivation({ retentionPolicyConfirmedAt: null, developmentPrincipalIds: ["dev_1"] });
    expect(decision.outcome).toBe("REJECTED");
    if (decision.outcome !== "REJECTED") return;
    expect(decision.reasons.map((r) => r.code).sort()).toEqual(["DEVELOPMENT_PRINCIPAL_IN_PATH", "RETENTION_POLICY_NOT_CONFIRMED"]);
  });
});
