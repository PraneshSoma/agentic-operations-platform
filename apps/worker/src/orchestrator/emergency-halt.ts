import type { ExecutionState, HaltRequest } from "@aop/contracts";
import type { IdentityResolver } from "@aop/identity";
import type { ExecutionStateMachine } from "./state-machine.js";
import type { ExecutionStateStore } from "./execution-state-store.js";

/**
 * Emergency halt / kill switch (D-05, spec §7A) — "a way to stop
 * something already executing or awaiting a step... independent of
 * whether anything has gone wrong yet." Halting is intentionally easier
 * to trigger than approving a mutation (spec §7A: "a false-positive halt
 * costs little; a missed halt during a live incident costs a great
 * deal") — this module has exactly one job and stays small on purpose.
 *
 * Scope disclosed explicitly: this story implements spec §7A items 1,
 * 4, 5 (revoke pending authorization is a no-op here — nothing in this
 * codebase yet issues a *pending, not-yet-consumed* authorization that
 * would need active revocation; ExecutionAuthorization is already
 * single-use per D-01/D-04) and the state transition + evidence + event
 * requirements, plus this story's own three acceptance criteria. Spec
 * §7A item 2 ("if the connector supports cancellation, attempt it") is
 * OUT OF SCOPE: no ActionConnector in this codebase defines a cancel()
 * capability (D-01 never added one, and none of this story's acceptance
 * criteria call for adding it) — inventing one now would be scope this
 * story wasn't asked to cover. `scope: "all_tenant_executions"` (halt-
 * all) is likewise out of scope: it requires a "list all in-flight
 * executions for a tenant" capability that ExecutionStateStore (B-03)
 * doesn't have yet; `haltExecution()` below rejects that scope value
 * explicitly rather than silently no-op'ing it.
 */
export type HaltResult =
  | { outcome: "HALTED"; execution: ExecutionState }
  | { outcome: "ALREADY_HALTED"; execution: ExecutionState }
  | { outcome: "REJECTED_UNAUTHORIZED_ACTOR" }
  | { outcome: "REJECTED_EXECUTION_NOT_FOUND" };

export interface HaltExecutionInput {
  tenantId: string;
  executionId: string;
  haltRequest: HaltRequest;
  /** Tenant-configured (spec §7A: "required_halt_roles is tenant-configured, e.g. senior_oncall, platform_owner"). */
  requiredHaltRoles: readonly string[];
  identityResolver: IdentityResolver;
  stateMachine: ExecutionStateMachine;
  stateStore: ExecutionStateStore;
}

const HALT_TERMINAL_STATES: ReadonlySet<ExecutionState["state"]> = new Set(["RESOLVED", "ESCALATED", "FAILED"]);

export async function haltExecution(input: HaltExecutionInput): Promise<HaltResult> {
  if (input.haltRequest.scope !== "single_execution") {
    throw new Error(
      `haltExecution() only supports scope "single_execution" — "${input.haltRequest.scope}" ` +
        `(halt-all) requires a tenant-wide execution listing capability ExecutionStateStore doesn't have yet`,
    );
  }

  // AUTHORIZATION: never trust haltRequest.actor.role (a caller-asserted
  // claim, carried through only as audit context) — resolve the actor's
  // REAL roles via IdentityResolver and check those, same discipline the
  // Approval Acceptance Gate already applies (C-04).
  const principal = await input.identityResolver.resolve(input.tenantId, input.haltRequest.actor.id);
  if (!principal || !principal.roles.some((role) => input.requiredHaltRoles.includes(role))) {
    return { outcome: "REJECTED_UNAUTHORIZED_ACTOR" };
  }

  const current = await input.stateStore.get(input.tenantId, input.executionId);
  if (!current) {
    return { outcome: "REJECTED_EXECUTION_NOT_FOUND" };
  }

  // Idempotent: halting an execution that's already halted is a no-op,
  // not an error (spec §7 "every transition must be idempotent" — a
  // second halt request for the same execution is exactly the kind of
  // re-delivery that requirement anticipates).
  if (current.state === "ESCALATED_HUMAN_OVERRIDE") {
    return { outcome: "ALREADY_HALTED", execution: current };
  }

  if (HALT_TERMINAL_STATES.has(current.state)) {
    throw new Error(
      `cannot halt execution "${input.executionId}" — it is already in terminal state "${current.state}"; ` +
        `halting only applies to in-flight work`,
    );
  }

  // NOTE (AC: "halt never attempts automatic rollback on an already-
  // completed action"): this function has no dependency on
  // ActionConnector or runRollbackDecision() at all, in its signature or
  // anywhere in its body — it is structurally impossible for it to
  // trigger a rollback, not merely guarded against doing so. Whatever
  // state the underlying action is in, halting only ever transitions
  // ExecutionState and surfaces the situation for a human, exactly as
  // spec §7A item 3 requires.
  const execution = await input.stateMachine.transitionTo({
    tenantId: input.tenantId,
    executionId: input.executionId,
    toState: "ESCALATED_HUMAN_OVERRIDE",
    eventType: "execution.halted",
    evidenceType: "OUTCOME",
    evidenceSummary: `Execution halted by "${input.haltRequest.actor.id}" (claimed role "${input.haltRequest.actor.role}"): ${input.haltRequest.reason}`,
    structuredData: {
      halt_request: input.haltRequest,
      resolved_actor_roles: principal.roles,
    },
  });

  return { outcome: "HALTED", execution };
}
