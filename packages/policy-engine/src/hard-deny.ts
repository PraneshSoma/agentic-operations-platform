import type { ActionDefinition, ExecutionAuthorization, HardDenyReasonCode, PolicyRule, ProposedAction } from "@aop/contracts";
import { ruleMatches } from "./rule-matching.js";

/**
 * The input every hard-deny check evaluates against. Deliberately richer
 * than the LLD's illustrative `evaluatePolicy(proposedAction)` signature
 * — a real Policy Engine needs the resolved ActionDefinition, target
 * environment, any existing authorization, and upstream-computed flags
 * (missing evidence, kill switch) to check ADR-008's 7 conditions; the
 * LLD pseudocode names the phases, not a literal exhaustive call
 * signature.
 */
export interface HardDenyCheckInput {
  proposedAction: ProposedAction;
  environment: string;
  /** undefined means no matching ActionDefinition was found — itself the UNREGISTERED_ACTION condition. */
  actionDefinition: ActionDefinition | undefined;
  existingAuthorization?: ExecutionAuthorization | undefined;
  /** Computed upstream from the matched OPC's required_context + the assembled ContextPackage.missing_context. */
  missingRequiredEvidence: boolean;
  killSwitchActive: boolean;
  now: Date;
  /** Tenant Phase 2 rules — read here ONLY to check immutable:true entries (see IMMUTABLE_POLICY_VIOLATION below). */
  policyRules: readonly PolicyRule[];
  effectiveRiskClass: "R0" | "R1" | "R2" | "R3";
}

export interface HardDenyCheck {
  code: HardDenyReasonCode;
  fails(input: HardDenyCheckInput): boolean;
  /** Sanitized, human-readable detail — never raw exception text (LLD-v1 §3's non-blocking correction). */
  sanitizedDetail(input: HardDenyCheckInput): string;
}

/**
 * HARD_DENY_CHECKS — the fixed, non-tenant-configurable Phase 1 list
 * (ADR-008's 7 conditions, LLD-v1 §3 gate 4, story C-03). This is a
 * `const` array in code, never loaded from tenant config — no tenant
 * policy authoring mistake can disable, reorder, or shadow any of these.
 * IMMUTABLE_POLICY_VIOLATION is the one entry that reads tenant-authored
 * data (PolicyRule.immutable) — see PolicyRuleSchema's doc comment for
 * why that's still a Phase 1, fixed-code concern: the CHECK is fixed and
 * runs before Phase 2 regardless of tenant config; only the individual
 * rule data is tenant-authored.
 */
export const HARD_DENY_CHECKS: readonly HardDenyCheck[] = [
  {
    code: "UNREGISTERED_ACTION",
    fails: (input) => input.actionDefinition === undefined,
    sanitizedDetail: (input) =>
      `No registered ActionDefinition for action_ref "${input.proposedAction.action_ref}" version "${input.proposedAction.action_version}"`,
  },
  {
    code: "TENANT_MISMATCH",
    fails: (input) => input.actionDefinition !== undefined && input.actionDefinition.tenant_id !== input.proposedAction.tenant_id,
    sanitizedDetail: () => "The resolved action's tenant does not match the proposal's tenant (NFR-04)",
  },
  {
    code: "EXPIRED_AUTHORIZATION",
    fails: (input) =>
      input.existingAuthorization !== undefined &&
      new Date(input.existingAuthorization.delegation.expires_at).getTime() <= input.now.getTime(),
    sanitizedDetail: () => "The existing execution authorization has expired",
  },
  {
    code: "PROHIBITED_ENVIRONMENT",
    fails: (input) =>
      input.actionDefinition !== undefined &&
      !(input.actionDefinition.environment_constraints.allowed as readonly string[]).includes(input.environment),
    sanitizedDetail: (input) => `Environment "${input.environment}" is not in the action's allowed environments`,
  },
  {
    code: "MISSING_REQUIRED_EVIDENCE",
    fails: (input) => input.missingRequiredEvidence,
    sanitizedDetail: () => "The matched OPC's required_context marks evidence as required, and it is absent from the assembled ContextPackage",
  },
  {
    code: "KILL_SWITCH_ACTIVE",
    fails: (input) => input.killSwitchActive,
    sanitizedDetail: () => "A halt is active for this execution or tenant — no re-authorization around a halt is permitted (spec §7A)",
  },
  {
    code: "IMMUTABLE_POLICY_VIOLATION",
    fails: (input) =>
      input.policyRules.some(
        (rule) => rule.immutable && rule.decision === "DENY" && ruleMatches(rule, input.environment, input.effectiveRiskClass),
      ),
    sanitizedDetail: (input) => {
      const violated = input.policyRules.find(
        (rule) => rule.immutable && rule.decision === "DENY" && ruleMatches(rule, input.environment, input.effectiveRiskClass),
      );
      return `Immutable tenant policy rule "${violated?.rule_id ?? "unknown"}" denies this action — not overridable`;
    },
  },
];
