import { randomUUID } from "node:crypto";
import {
  ExecutionResultSchema,
  type ActionDefinition,
  type ConnectorDescriptor,
  type ExecutionAuthorization,
  type ExecutionResult,
  type PreconditionSet,
  type PreflightResult,
  type StatusCheckResult,
} from "@aop/contracts";
import type { SecretResolver } from "@aop/secrets";
import { ExpiredAuthorizationError, MissingAuthorizationError, type ActionConnector, type ValidationResult } from "./action-connector.js";
import { deepEqual } from "./deep-equal.js";

type Tolerance = "exact" | "within_range" | "unchanged_since";

function matchesTolerance(observed: unknown, expected: unknown, tolerance: Tolerance): boolean {
  switch (tolerance) {
    case "exact":
      return deepEqual(observed, expected);
    case "unchanged_since":
      // Simplified for this simulated connector: "unchanged since X" is
      // checked as "still equals the last known value X" — a real
      // implementation against a real target would additionally need a
      // last-modified timestamp; that level of fidelity isn't needed to
      // prove the governed pipeline end-to-end (this story's own scope).
      return deepEqual(observed, expected);
    case "within_range": {
      if (typeof observed !== "number") return false;
      const range = expected as { min: number; max: number };
      return observed >= range.min && observed <= range.max;
    }
  }
}

function assertAuthorization(authorization: ExecutionAuthorization | undefined, operation: "execute" | "rollback", now: Date): void {
  if (!authorization) {
    throw new MissingAuthorizationError(operation);
  }
  if (new Date(authorization.delegation.expires_at).getTime() <= now.getTime()) {
    throw new ExpiredAuthorizationError(authorization.authorization_id, authorization.delegation.expires_at);
  }
}

/**
 * SimulatedActionConnector — story D-01. Implements the full
 * ActionConnector interface (spec §14) against a fake, in-memory
 * "sandboxed target" (a Map), never a real production system — proving
 * the complete governed pipeline (policy -> approval -> frozen plan ->
 * preflight -> execute -> rollback) end-to-end without a real mutation.
 *
 * The target state map is genuinely mutated by execute() and genuinely
 * read by preflight() — this is not a stub that always returns success;
 * a staged drift in the target state is really caught by preflight(),
 * and rollback() really reverts what execute() changed, from a snapshot
 * taken at execute() time.
 */
export class SimulatedActionConnector implements ActionConnector {
  private readonly targetState = new Map<string, unknown>();
  private readonly executeSnapshots = new Map<string, ReadonlyMap<string, unknown>>();
  /** operation_id -> the ExecutionResult it genuinely produced — statusCheck()'s real source of truth (D-07), not a stub. */
  private readonly completedOperations = new Map<string, ExecutionResult>();
  /** Test/observability only — stages a genuinely inconclusive statusCheck() answer for a given operation_id, simulating "the connector can't tell." */
  private readonly inconclusiveOperationIds = new Set<string>();

  constructor(
    private readonly connectorDescriptor: ConnectorDescriptor,
    private readonly secretResolver: SecretResolver,
    initialState: ReadonlyMap<string, unknown> = new Map(),
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const [key, value] of initialState) this.targetState.set(key, value);
  }

  descriptor(): ConnectorDescriptor {
    return this.connectorDescriptor;
  }

  /** Test/observability helper — read the simulated target's current state. */
  getTargetState(key: string): unknown {
    return this.targetState.get(key);
  }

  validateAction(action: ActionDefinition, _parameters: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (action.status !== "active") errors.push(`action "${action.action_id}" is not active`);
    if (action.executor_connector_ref !== this.connectorDescriptor.connector_id) {
      errors.push(
        `action's executor_connector_ref ("${action.executor_connector_ref}") does not match this connector ("${this.connectorDescriptor.connector_id}")`,
      );
    }
    return { valid: errors.length === 0, errors };
  }

  async preflight(
    _action: ActionDefinition,
    _parameters: Record<string, unknown>,
    expectedPreconditions: PreconditionSet,
  ): Promise<PreflightResult> {
    await this.secretResolver.resolve(this.connectorDescriptor.authorization.secret_ref);

    const drifted: PreflightResult["drifted_fields"] = [];
    for (const check of expectedPreconditions.checks) {
      if (!this.targetState.has(check.field_ref)) {
        // The preflight itself cannot observe this field at all —
        // UNKNOWN, never an implicit pass (spec §14B).
        return { status: "UNKNOWN", drifted_fields: [] };
      }
      const observed = this.targetState.get(check.field_ref);
      if (!matchesTolerance(observed, check.expected_value, check.tolerance)) {
        drifted.push({ field_ref: check.field_ref, expected: check.expected_value, observed });
      }
    }

    return drifted.length > 0 ? { status: "DRIFTED", drifted_fields: drifted } : { status: "MATCH", drifted_fields: [] };
  }

  async execute(
    action: ActionDefinition,
    parameters: Record<string, unknown>,
    authorization: ExecutionAuthorization | undefined,
    operationId: string,
  ): Promise<ExecutionResult> {
    const now = this.now();
    assertAuthorization(authorization, "execute", now);
    await this.secretResolver.resolve(this.connectorDescriptor.authorization.secret_ref);

    const touchedKeys = Object.keys(parameters);
    const priorValues = new Map(touchedKeys.map((key) => [key, this.targetState.get(key)]));
    for (const [key, value] of Object.entries(parameters)) this.targetState.set(key, value);

    const completedAt = this.now();
    const result = ExecutionResultSchema.parse({
      execution_result_id: randomUUID(),
      proposal_id: authorization!.proposal_id,
      action_ref: action.action_id,
      started_at: now.toISOString(),
      completed_at: completedAt.toISOString(),
      status: "SUCCESS",
      output_summary: `Applied ${touchedKeys.length} parameter(s) to the simulated target`,
      side_effects: { entities_changed: touchedKeys.length, systems_touched: [this.connectorDescriptor.connector_id] },
      error: {},
      rollback_available: action.reversible,
      executor_build_hash: "sha256:simulated-action-connector-build",
    });

    this.executeSnapshots.set(result.execution_result_id, priorValues);
    // Genuinely recorded, not stubbed — statusCheck() answers CONFIRMED_EXECUTED
    // from this map, the same way a real system's own idempotency-key
    // bookkeeping would let it answer a later query about operationId.
    this.completedOperations.set(operationId, result);
    return result;
  }

  /** Test/observability helper — stages a genuinely inconclusive statusCheck() answer for the given operation_id (D-07). */
  stageInconclusiveStatusCheck(operationId: string): void {
    this.inconclusiveOperationIds.add(operationId);
  }

  async statusCheck(operationId: string, _actionVersion: string, connectorVersion: string): Promise<StatusCheckResult> {
    if (connectorVersion !== this.connectorDescriptor.definition_version) {
      // LLD-v1 §6: version fields let the connector "reject a check
      // against a build it doesn't recognize rather than guessing" — an
      // unrecognized build answers INCONCLUSIVE, never a confident guess.
      return {
        outcome: "INCONCLUSIVE",
        detail: `connector build "${this.connectorDescriptor.definition_version}" does not recognize connector_version "${connectorVersion}"`,
      };
    }

    if (this.inconclusiveOperationIds.has(operationId)) {
      return { outcome: "INCONCLUSIVE", detail: "simulated: connector could not confirm this operation" };
    }

    const completed = this.completedOperations.get(operationId);
    if (completed) {
      return { outcome: "CONFIRMED_EXECUTED", detail: `execution_result_id "${completed.execution_result_id}"` };
    }

    return { outcome: "CONFIRMED_NOT_EXECUTED" };
  }

  async rollback(executionResult: ExecutionResult, authorization: ExecutionAuthorization | undefined): Promise<ExecutionResult> {
    const now = this.now();
    assertAuthorization(authorization, "rollback", now);
    await this.secretResolver.resolve(this.connectorDescriptor.authorization.secret_ref);

    const priorValues = this.executeSnapshots.get(executionResult.execution_result_id);
    if (!priorValues) {
      throw new Error(`No rollback snapshot available for execution result "${executionResult.execution_result_id}"`);
    }

    for (const [key, value] of priorValues) {
      if (value === undefined) this.targetState.delete(key);
      else this.targetState.set(key, value);
    }

    return ExecutionResultSchema.parse({
      execution_result_id: randomUUID(),
      proposal_id: executionResult.proposal_id,
      action_ref: executionResult.action_ref,
      started_at: now.toISOString(),
      completed_at: this.now().toISOString(),
      status: "SUCCESS",
      output_summary: `Rolled back execution result "${executionResult.execution_result_id}"`,
      side_effects: { entities_changed: priorValues.size, systems_touched: [this.connectorDescriptor.connector_id] },
      error: {},
      rollback_available: false,
      executor_build_hash: "sha256:simulated-action-connector-build",
    });
  }
}
