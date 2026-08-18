import {
  PolicyDecisionSchema,
  PolicyRuleSchema,
  type ActionDefinition,
  type ExecutionAuthorization,
  type PolicyDecision,
  type ProposedAction,
} from "@aop/contracts";
import { z } from "zod";
import { HARD_DENY_CHECKS } from "./hard-deny.js";
import { ruleMatches } from "./rule-matching.js";

const PolicyRuleListSchema = z.array(PolicyRuleSchema);

/**
 * evaluatePolicy's full input. `decisionId` and `createdAt` are
 * caller-supplied (not generated inside this function) specifically so
 * evaluatePolicy is a PURE function of its arguments — that purity is
 * what makes NFR-05 ("same ProposedAction + policy version evaluated
 * twice produces a byte-identical PolicyDecision") a structural property
 * of the function, not something only true "most of the time."
 *
 * `policyRules` is typed `unknown` deliberately — it represents
 * tenant-authored config that may not have been validated yet at the
 * point evaluatePolicy is called; parsing it INSIDE the try block (below)
 * is both CONTEXT.md RULE 1 (parse at the boundary) and the mechanism
 * that makes a malformed rule resolve to DENY(POLICY_EVALUATION_FAILED)
 * rather than crash uncaught.
 */
export interface PolicyEvaluationInput {
  decisionId: string;
  createdAt: string;
  proposedAction: ProposedAction;
  environment: string;
  actionDefinition: ActionDefinition | undefined;
  existingAuthorization?: ExecutionAuthorization | undefined;
  missingRequiredEvidence: boolean;
  killSwitchActive: boolean;
  policyRules: unknown;
  policyVersion: string;
  evidenceSummary: PolicyDecision["evidence_summary"];
  now: Date;
}

function denyPolicyEvaluationFailed(input: PolicyEvaluationInput): PolicyDecision {
  return PolicyDecisionSchema.parse({
    decision_id: input.decisionId,
    proposal_id: input.proposedAction.proposal_id,
    policy_version: input.policyVersion,
    // Best-effort — evaluation itself failed, so there is no reliably
    // computed effective risk; the proposal's own requested class is the
    // only value available without re-entering the failed computation.
    effective_risk_class: input.proposedAction.risk_assessment.requested_risk_class,
    outcome: "DENY",
    reasons: [],
    evidence_summary: input.evidenceSummary,
    hard_deny_reason_code: "POLICY_EVALUATION_FAILED",
    hard_deny_detail: "Policy evaluation failed (exception, malformed rule, or missing required input) — fail-closed to DENY, never REQUIRE_APPROVAL",
    requires_proposer_approver_separation: false,
    created_at: input.createdAt,
  });
}

/**
 * evaluatePolicy — spec §16's Policy Engine, LLD-v1 §3's two-phase design
 * (story C-03). Phase 1 (fixed, non-tenant-configurable HARD_DENY_CHECKS)
 * runs before Phase 2 (tenant PolicyRule evaluation) and cannot be
 * skipped or shadowed by any tenant rule. ANY exception anywhere in
 * either phase — malformed rule, missing input, an unexpected throw —
 * is caught by the single try/catch wrapping both phases and resolves to
 * DENY(POLICY_EVALUATION_FAILED), never REQUIRE_APPROVAL (ADR-008's
 * fail-closed rule).
 */
export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecision {
  try {
    const policyRules = PolicyRuleListSchema.parse(input.policyRules);
    const effectiveRiskClass = input.actionDefinition
      ? input.actionDefinition.default_risk_class
      : input.proposedAction.risk_assessment.requested_risk_class;

    // PHASE 1 — fixed, cannot be skipped.
    for (const check of HARD_DENY_CHECKS) {
      const checkInput = {
        proposedAction: input.proposedAction,
        environment: input.environment,
        actionDefinition: input.actionDefinition,
        existingAuthorization: input.existingAuthorization,
        missingRequiredEvidence: input.missingRequiredEvidence,
        killSwitchActive: input.killSwitchActive,
        now: input.now,
        policyRules,
        effectiveRiskClass,
      };
      if (check.fails(checkInput)) {
        return PolicyDecisionSchema.parse({
          decision_id: input.decisionId,
          proposal_id: input.proposedAction.proposal_id,
          policy_version: input.policyVersion,
          effective_risk_class: effectiveRiskClass,
          outcome: "DENY",
          reasons: [],
          evidence_summary: input.evidenceSummary,
          hard_deny_reason_code: check.code,
          hard_deny_detail: check.sanitizedDetail(checkInput),
          requires_proposer_approver_separation: false,
          created_at: input.createdAt,
        });
      }
    }

    // PHASE 2 — tenant PolicyRule evaluation. First match wins; no match
    // defaults to REQUIRE_APPROVAL (a normal evaluation result, not a
    // failure — an unconfigured tenant gets routed to a human, never
    // auto-ALLOW and never DENY, which is reserved for Phase 1 and an
    // explicit tenant DENY rule).
    const matched = policyRules.find((rule) => ruleMatches(rule, input.environment, effectiveRiskClass));

    return PolicyDecisionSchema.parse({
      decision_id: input.decisionId,
      proposal_id: input.proposedAction.proposal_id,
      policy_version: input.policyVersion,
      effective_risk_class: effectiveRiskClass,
      outcome: matched?.decision ?? "REQUIRE_APPROVAL",
      approval_route: matched?.approval_route,
      reasons: matched
        ? [{ rule_id: matched.rule_id, explanation: `Matched tenant policy rule "${matched.rule_id}"` }]
        : [{ rule_id: "no_match_default", explanation: "No tenant policy rule matched; defaulting to REQUIRE_APPROVAL" }],
      evidence_summary: input.evidenceSummary,
      requires_proposer_approver_separation: matched?.requires_proposer_approver_separation ?? false,
      created_at: input.createdAt,
    });
  } catch {
    return denyPolicyEvaluationFailed(input);
  }
}
