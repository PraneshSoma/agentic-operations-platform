import type { ActionDefinition, ExecutionAuthorization, ExecutionResult, PreconditionSet, PreflightResult } from "@aop/contracts";
import type { ActionConnector } from "./action-connector.js";

/**
 * Gated execution (D-02) — the structural enforcement point for spec
 * §14B / F-10: "preflight runs immediately before every execute() call."
 *
 * D-01's SimulatedActionConnector already implements real MATCH/DRIFTED/
 * UNKNOWN detection in preflight() and real mutation in execute() — but
 * nothing in that story *forced* the caller to run one before the other,
 * or to stop when preflight comes back anything other than MATCH. That's
 * this module's entire job, and it's also the concrete mechanism behind
 * CONTEXT.md RULE 6 ("No agent-facing code path may call
 * ActionConnector.execute() directly; it is only ever invoked by the
 * executor with a signed ExecutionAuthorization") — runGatedExecution()
 * is the one place execute() is reachable from outside a connector's own
 * tests.
 *
 * DRIFTED blocks unconditionally — no override, no "proceed anyway."
 * UNKNOWN (the check itself couldn't be evaluated) is treated as missing
 * required context, never an implicit pass: it blocks exactly like
 * DRIFTED, it's just reported under its own outcome so a caller can tell
 * "the world changed" apart from "we couldn't tell whether it changed."
 */
export type GatedExecutionResult =
  | { outcome: "EXECUTED"; preflightResult: PreflightResult; executionResult: ExecutionResult }
  | { outcome: "BLOCKED_DRIFTED"; preflightResult: PreflightResult }
  | { outcome: "BLOCKED_UNKNOWN"; preflightResult: PreflightResult };

export async function runGatedExecution(
  connector: ActionConnector,
  action: ActionDefinition,
  parameters: Record<string, unknown>,
  expectedPreconditions: PreconditionSet,
  authorization: ExecutionAuthorization,
): Promise<GatedExecutionResult> {
  const preflightResult = await connector.preflight(action, parameters, expectedPreconditions);

  if (preflightResult.status === "DRIFTED") {
    return { outcome: "BLOCKED_DRIFTED", preflightResult };
  }
  if (preflightResult.status === "UNKNOWN") {
    return { outcome: "BLOCKED_UNKNOWN", preflightResult };
  }

  const executionResult = await connector.execute(action, parameters, authorization);
  return { outcome: "EXECUTED", preflightResult, executionResult };
}
