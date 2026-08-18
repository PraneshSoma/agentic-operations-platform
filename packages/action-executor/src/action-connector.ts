import type {
  ActionDefinition,
  ConnectorDescriptor,
  ExecutionAuthorization,
  ExecutionResult,
  PreconditionSet,
  PreflightResult,
  StatusCheckResult,
} from "@aop/contracts";

/**
 * ActionConnector (spec §14) — the write interface. Deliberately a
 * SEPARATE interface from ContextConnector (packages/context-service),
 * in a separate package — CONTEXT.md RULE 3: "a single class must never
 * implement both."
 *
 * descriptor() returns the same ConnectorDescriptor shape read connectors
 * use (spec §10) — spec §14 names a distinct `ActionConnectorDescriptor`
 * type but never defines its shape separately from §10's descriptor; the
 * fields that matter (connector_id, tenant_id, authorization, scopes,
 * staleness) are identical in meaning for a write connector, so this
 * reuses the existing contract rather than inventing a parallel one with
 * no spec-given fields to differ by.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ActionConnector {
  descriptor(): ConnectorDescriptor;

  validateAction(action: ActionDefinition, parameters: Record<string, unknown>): ValidationResult;

  preflight(action: ActionDefinition, parameters: Record<string, unknown>, expectedPreconditions: PreconditionSet): Promise<PreflightResult>;

  /**
   * Executor requirements (spec §14): receives a signed ExecutionAuthorization,
   * rejects expired tokens, never accepts a free-form model instruction.
   * `operationId` (LLD-v1 §2/§7.2, story D-07) is the SAME stable id the
   * caller derived via `deriveOperationId()` and recorded on the
   * ExecutionStepMarker before this call — threading it through here is
   * what lets a later `statusCheck()` call, after a crash, ask "did THIS
   * specific logical operation actually happen," the way a real
   * idempotency key would against a real production system.
   */
  execute(action: ActionDefinition, parameters: Record<string, unknown>, authorization: ExecutionAuthorization, operationId: string): Promise<ExecutionResult>;

  rollback?(executionResult: ExecutionResult, authorization: ExecutionAuthorization): Promise<ExecutionResult>;

  /**
   * ADR-004's mandatory status check on EXECUTION_UNCERTAIN (LLD-v1 §6/§7.2,
   * story D-07). MUST answer against the SAME operation_id passed to
   * execute() — never invent a fresh id, never guess. INCONCLUSIVE is a
   * legitimate, expected answer (a real connector may genuinely be unable
   * to tell), not a failure of this method; the caller's fail-closed rule
   * (ADR-004) is what decides what happens next, not this method.
   */
  statusCheck(operationId: string, actionVersion: string, connectorVersion: string): Promise<StatusCheckResult>;
}

/** Thrown by execute()/rollback() when called without a resolved ExecutionAuthorization at all (story D-01's 3rd acceptance criterion). */
export class MissingAuthorizationError extends Error {
  constructor(operation: "execute" | "rollback") {
    super(`${operation}() requires a resolved ExecutionAuthorization — none was provided`);
    this.name = "MissingAuthorizationError";
  }
}

/** Thrown when the supplied ExecutionAuthorization's delegation has already expired (spec §14: "rejects expired approval tokens"). */
export class ExpiredAuthorizationError extends Error {
  constructor(public readonly authorization_id: string, public readonly expired_at: string) {
    super(`ExecutionAuthorization "${authorization_id}" expired at ${expired_at}`);
    this.name = "ExpiredAuthorizationError";
  }
}
