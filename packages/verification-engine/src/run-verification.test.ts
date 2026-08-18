import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "@aop/contracts";
import { runVerification, type VerificationCheckInput } from "./run-verification.js";

function executionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    execution_result_id: "res_1",
    proposal_id: "prop_1",
    action_ref: "restart_service",
    started_at: "2026-08-18T12:00:00.000Z",
    completed_at: "2026-08-18T12:01:00.000Z",
    status: "SUCCESS",
    output_summary: "restarted",
    side_effects: { systems_touched: ["sim-action-connector"] },
    error: {},
    rollback_available: true,
    executor_build_hash: "sha256:test-build",
    ...overrides,
  };
}

function check(overrides: Partial<VerificationCheckInput> = {}): VerificationCheckInput {
  return { name: "PRODUCTION_EVIDENCE", status: "PASS", evidence_ids: ["ev_1"], ...overrides };
}

describe("runVerification() — Verification Engine decision policy (D-03, F-13)", () => {
  it("all checks PASS -> VERIFIED, recommended_next_step CLOSE", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult(),
      checks: [check(), check({ name: "POLICY_CHECK" })],
      compensationClass: "REVERSIBLE",
    });
    expect(result.overall).toBe("VERIFIED");
    expect(result.recommended_next_step).toBe("CLOSE");
  });

  it("CRITICAL: no checks at all -> INCONCLUSIVE, never an implicit VERIFIED pass", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult(),
      checks: [],
      compensationClass: "REVERSIBLE",
    });
    expect(result.overall).toBe("INCONCLUSIVE");
    expect(result.recommended_next_step).toBe("ESCALATE");
  });

  it("CRITICAL: FAILED never marks the ticket resolved — recommended_next_step is never CLOSE", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult(),
      checks: [check({ status: "FAIL" })],
      compensationClass: "REVERSIBLE",
    });
    expect(result.overall).toBe("FAILED");
    expect(result.recommended_next_step).not.toBe("CLOSE");
  });

  it("CRITICAL: INCONCLUSIVE never marks the ticket resolved — recommended_next_step is never CLOSE", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult(),
      checks: [check({ status: "UNKNOWN" })],
      compensationClass: "REVERSIBLE",
    });
    expect(result.overall).toBe("INCONCLUSIVE");
    expect(result.recommended_next_step).not.toBe("CLOSE");
  });

  it("CRITICAL: INCONCLUSIVE always ESCALATEs — never ROLLBACK, even for a REVERSIBLE action (spec §30)", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult(),
      checks: [check({ status: "PASS" }), check({ status: "UNKNOWN" })],
      compensationClass: "REVERSIBLE",
    });
    expect(result.overall).toBe("INCONCLUSIVE");
    expect(result.recommended_next_step).toBe("ESCALATE");
  });

  it("FAILED + REVERSIBLE -> ROLLBACK", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult(),
      checks: [check({ status: "FAIL" })],
      compensationClass: "REVERSIBLE",
    });
    expect(result.recommended_next_step).toBe("ROLLBACK");
  });

  it("FAILED + COMPENSATABLE -> ROLLBACK", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult(),
      checks: [check({ status: "FAIL" })],
      compensationClass: "COMPENSATABLE",
    });
    expect(result.recommended_next_step).toBe("ROLLBACK");
  });

  it("CRITICAL: FAILED + IRREVERSIBLE -> ESCALATE, never ROLLBACK", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult(),
      checks: [check({ status: "FAIL" })],
      compensationClass: "IRREVERSIBLE",
    });
    expect(result.overall).toBe("FAILED");
    expect(result.recommended_next_step).toBe("ESCALATE");
  });

  it("FAIL takes precedence over UNKNOWN when both are present -> overall FAILED", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult(),
      checks: [check({ status: "FAIL" }), check({ status: "UNKNOWN", name: "POLICY_CHECK" })],
      compensationClass: "REVERSIBLE",
    });
    expect(result.overall).toBe("FAILED");
  });

  it("returns a schema-valid VerificationResult carrying the execution_result_id and check evidence through", () => {
    const result = runVerification({
      verificationId: "ver_1",
      executionResult: executionResult({ execution_result_id: "res_42" }),
      checks: [check({ evidence_ids: ["ev_a", "ev_b"] })],
      compensationClass: "REVERSIBLE",
    });
    expect(result.verification_id).toBe("ver_1");
    expect(result.execution_result_id).toBe("res_42");
    expect(result.checks).toEqual([{ name: "PRODUCTION_EVIDENCE", status: "PASS", evidence_ids: ["ev_a", "ev_b"] }]);
  });
});
