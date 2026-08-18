import type { PolicyRule } from "@aop/contracts";

/**
 * Whether a PolicyRule's `when` matches — structural, deterministic (spec
 * §16: "The policy engine must be deterministic"). An unset `when` field
 * matches any value for that dimension (a rule that doesn't constrain
 * environment applies to every environment, etc.).
 */
export function ruleMatches(rule: PolicyRule, environment: string, effectiveRiskClass: "R0" | "R1" | "R2" | "R3"): boolean {
  if (rule.when.environment !== undefined && rule.when.environment !== environment) return false;
  if (rule.when.risk_class_in !== undefined && !rule.when.risk_class_in.includes(effectiveRiskClass)) return false;
  return true;
}
