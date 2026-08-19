/**
 * Tenant activation gate (story E-07, LLD-v1 §6) — the UNIFIED
 * production-onboarding gate combining ADR-011's retention requirement
 * and ADR-012's dev-principal requirement. A tenant may go to production
 * ONLY when both hold:
 *
 *   1. `retention_policy_confirmed_at` is set — a real, documented
 *      per-class retention decision has been recorded (ADR-011: the
 *      finite dev default "is a placeholder that expires with the
 *      prototype, not something that silently becomes the policy by
 *      inertia").
 *   2. No production-flagged execution path resolves through an
 *      `is_development_principal` identity (ADR-012: "a real pilot doesn't
 *      accidentally run on placeholder identities").
 *
 * This is the pure decision — real, technical, fail-closed (a REJECT is
 * returned with concrete reasons; there is no "activate anyway" path). The
 * repository/route around it does the actual read + activation write.
 */
export type ActivationRejectionReason =
  | { code: "RETENTION_POLICY_NOT_CONFIRMED" }
  | { code: "DEVELOPMENT_PRINCIPAL_IN_PATH"; development_principal_ids: string[] };

export type ActivationDecision =
  | { outcome: "READY" }
  | { outcome: "REJECTED"; reasons: ActivationRejectionReason[] };

export interface ActivationInput {
  /** null/undefined until the tenant records its retention decision (ADR-011). */
  retentionPolicyConfirmedAt: string | null | undefined;
  /** Ids of the tenant's principals flagged is_development_principal (ADR-012). Non-empty blocks activation. */
  developmentPrincipalIds: string[];
}

export function evaluateActivation(input: ActivationInput): ActivationDecision {
  const reasons: ActivationRejectionReason[] = [];

  if (!input.retentionPolicyConfirmedAt) {
    reasons.push({ code: "RETENTION_POLICY_NOT_CONFIRMED" });
  }
  if (input.developmentPrincipalIds.length > 0) {
    reasons.push({ code: "DEVELOPMENT_PRINCIPAL_IN_PATH", development_principal_ids: [...input.developmentPrincipalIds].sort() });
  }

  return reasons.length > 0 ? { outcome: "REJECTED", reasons } : { outcome: "READY" };
}
