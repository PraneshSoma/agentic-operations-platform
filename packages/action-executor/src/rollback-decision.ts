import type { ActionDefinition, ExecutionAuthorization, ExecutionResult, VerificationResult } from "@aop/contracts";
import type { ActionConnector } from "./action-connector.js";

/**
 * Rollback decision gate (D-04, spec §20, F-14) — the structural
 * enforcement point for the three-class compensation split (ADR-001).
 * F-14 reworked v1's assumption that `reversible: true` uniformly means
 * "rollback is available" — the three classes behave differently even
 * when verification recommends ROLLBACK:
 *
 *   - REVERSIBLE: a direct, instant technical reversal exists. This gate
 *     may call `connector.rollback()` directly, under the same
 *     authorization model as forward execution.
 *   - COMPENSATABLE: no instant reversal exists — a corrective action can
 *     be proposed, but F-14 is explicit that the compensating action is
 *     itself a new, fully governed `ProposedAction` (planning, policy,
 *     approval again), never an automatic bypass. This gate therefore
 *     never calls `connector.rollback()` for a COMPENSATABLE action —
 *     doing so would represent a governed re-proposal as an instant
 *     reversal, exactly what F-14 forbids. It returns
 *     `COMPENSATION_REQUIRED` instead; actually driving that action back
 *     through planning/policy/approval is out of this MVP gate's scope
 *     (F-14's own AC marks the real re-governed flow Post-MVP).
 *   - IRREVERSIBLE: no rollback path exists at all. Rollback is NEVER
 *     attempted, under any circumstance — verification failure escalates
 *     to a human directly, full stop.
 *
 * Defense in depth, same shape as the Policy Engine's HARD_DENY_CHECKS
 * (C-03): D-03's `runVerification()` already guarantees
 * `recommended_next_step` is never `ROLLBACK` for an IRREVERSIBLE action,
 * so the IRREVERSIBLE-but-ROLLBACK-recommended branch below should be
 * unreachable in practice — but this gate checks the action's own
 * `compensation_class` independently rather than trusting the
 * verification result's word for it, and throws loudly instead of
 * silently proceeding if the two ever disagree.
 */
export type RollbackDecisionResult =
  | { outcome: "ROLLED_BACK"; executionResult: ExecutionResult }
  | { outcome: "COMPENSATION_REQUIRED" }
  | { outcome: "NOT_ATTEMPTED"; reason: "NO_ROLLBACK_RECOMMENDED" | "IRREVERSIBLE" };

export async function runRollbackDecision(
  connector: ActionConnector,
  action: ActionDefinition,
  verificationResult: VerificationResult,
  originalExecutionResult: ExecutionResult,
  authorization: ExecutionAuthorization,
): Promise<RollbackDecisionResult> {
  if (action.compensation_class === "IRREVERSIBLE") {
    if (verificationResult.recommended_next_step === "ROLLBACK") {
      // Should be unreachable — runVerification() never recommends ROLLBACK
      // for an IRREVERSIBLE action. Fail loud rather than silently honoring
      // a recommendation this gate's own independent check disagrees with.
      throw new Error(
        `action "${action.action_id}" is IRREVERSIBLE — rollback must never be attempted, ` +
          `but the verification result recommended ROLLBACK anyway`,
      );
    }
    return { outcome: "NOT_ATTEMPTED", reason: "IRREVERSIBLE" };
  }

  if (verificationResult.recommended_next_step !== "ROLLBACK") {
    return { outcome: "NOT_ATTEMPTED", reason: "NO_ROLLBACK_RECOMMENDED" };
  }

  if (action.compensation_class === "COMPENSATABLE") {
    // Never call connector.rollback() here — a COMPENSATABLE action's
    // remedy is a new, fully governed ProposedAction (F-14), not an
    // instant technical reversal. Driving that re-proposal through
    // planning/policy/approval is Post-MVP; this gate's job is only to
    // never misrepresent it as the REVERSIBLE case.
    return { outcome: "COMPENSATION_REQUIRED" };
  }

  // action.compensation_class === "REVERSIBLE"
  if (!connector.rollback) {
    throw new Error(
      `connector "${connector.descriptor().connector_id}" does not implement rollback(), ` +
        `but action "${action.action_id}" (REVERSIBLE) requires it`,
    );
  }

  const executionResult = await connector.rollback(originalExecutionResult, authorization);
  return { outcome: "ROLLED_BACK", executionResult };
}
