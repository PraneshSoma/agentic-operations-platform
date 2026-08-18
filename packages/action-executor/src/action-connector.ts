import type { ActionDefinition, ConnectorDescriptor, ExecutionAuthorization, ExecutionResult, PreconditionSet, PreflightResult } from "@aop/contracts";

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

  /** Executor requirements (spec §14): receives a signed ExecutionAuthorization, rejects expired tokens, never accepts a free-form model instruction. */
  execute(action: ActionDefinition, parameters: Record<string, unknown>, authorization: ExecutionAuthorization): Promise<ExecutionResult>;

  rollback?(executionResult: ExecutionResult, authorization: ExecutionAuthorization): Promise<ExecutionResult>;
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
