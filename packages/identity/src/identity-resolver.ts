import type { IdentityPrincipal } from "@aop/contracts";

/**
 * The same 4-value risk class enum already used inline by ActionDefinition
 * (default_risk_class) and PolicyDecision (effective_risk_class) in
 * packages/contracts — duplicated here rather than newly centralized,
 * since promoting it to a shared exported schema would mean editing two
 * already-ACCEPTED contract files for a story that doesn't need to.
 */
export type RiskClass = "R0" | "R1" | "R2" | "R3";

/**
 * IdentityResolver (ADR-012, LLD-v1 §5, story C-01) — resolves an actor
 * reference to identity, tenant_id, roles, and risk-class approval
 * permission. Interface + pluggable-implementation pattern, mirroring
 * SecretResolver's pattern (ADR-009) per ADR-012's own decision text.
 *
 * The SAME resolve() method and the SAME backing table serve both call
 * sites ADR-012 names explicitly: resolving `IncomingRequest.requester`
 * (who submitted the trigger) and resolving `ApprovalDecision.actor` (who
 * approved the action) — there is no separate "requester table" and
 * "approver table"; both are just principals in one tenant-scoped
 * registry, looked up by the same (tenant_id, actor_id) key.
 */
export interface IdentityResolver {
  resolve(tenantId: string, actorId: string): Promise<IdentityPrincipal | undefined>;
  /** Whether any of the principal's roles satisfy approval of the given risk class (feeds F-08's policy routing). */
  hasRiskClassApprovalPermission(principal: IdentityPrincipal, riskClass: RiskClass): boolean;
}
