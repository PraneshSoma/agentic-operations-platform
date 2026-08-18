import type { ResolutionPlan, ResolutionPlanStep } from "@aop/contracts";
import { deepEqual } from "./deep-equal.js";

/**
 * Thrown when a requested execution step doesn't correspond to any step
 * in the approved plan, or names an action_ref different from the frozen
 * step's — spec §12's Frozen Plan Rule: "the executor cannot add or
 * substitute actions" once a human has approved a plan.
 */
export class UnapprovedActionError extends Error {
  constructor(
    public readonly step_id: string,
    reason: "step not in approved plan" | "action_ref does not match the approved step",
  ) {
    super(`Frozen Plan Rule violation on step "${step_id}": ${reason}`);
    this.name = "UnapprovedActionError";
  }
}

/**
 * Thrown when a requested step's parameters differ from the frozen,
 * approved step's parameters — spec §12: "changed parameters require
 * re-approval". This is a rejection, never a silent proceed: the executor
 * must route back through approval, not execute with the drifted
 * parameters.
 */
export class ParameterChangedError extends Error {
  constructor(
    public readonly step_id: string,
    public readonly approved_parameters: Record<string, unknown> | undefined,
    public readonly requested_parameters: Record<string, unknown> | undefined,
  ) {
    super(
      `Frozen Plan Rule violation on step "${step_id}": requested parameters differ from the ` +
        `approved plan's parameters — this requires re-approval, execution does not proceed`,
    );
    this.name = "ParameterChangedError";
  }
}

export interface RequestedExecutionStep {
  step_id: string;
  action_ref: string;
  parameters?: Record<string, unknown>;
}

/**
 * assertMatchesFrozenPlan — spec §12's Frozen Plan Rule, story B-06.
 * Called by the executor immediately before running an ACTION step
 * against an approved ResolutionPlan. Throws (never silently allows) on
 * either violation:
 *
 * 1. UnapprovedActionError — the requested step_id isn't in the approved
 *    plan at all, or its action_ref doesn't match the frozen step's
 *    action_ref. Covers both "add" (unknown step_id) and "substitute"
 *    (known step_id, different action) (F-06).
 * 2. ParameterChangedError — the requested parameters aren't deep-equal
 *    to the approved step's frozen parameters.
 *
 * READ/VERIFY-type frozen steps aren't gated by this function — spec §12
 * explicitly permits "additional read-only verification ... if policy
 * allows"; only ACTION-type (mutating) steps are frozen. Enforcing that
 * distinction at the call site (only ACTION steps are ever passed here)
 * is the executor's responsibility, not this guard's — this function's
 * only job is "does this requested step match what was approved,
 * exactly," for whatever step it's given.
 */
export function assertMatchesFrozenPlan(approvedPlan: ResolutionPlan, requested: RequestedExecutionStep): void {
  const approvedStep = approvedPlan.steps.find((step) => step.step_id === requested.step_id);

  if (!approvedStep) {
    throw new UnapprovedActionError(requested.step_id, "step not in approved plan");
  }
  if (approvedStep.action_ref !== requested.action_ref) {
    throw new UnapprovedActionError(requested.step_id, "action_ref does not match the approved step");
  }
  if (!deepEqual(approvedStep.parameters, requested.parameters)) {
    throw new ParameterChangedError(requested.step_id, approvedStep.parameters, requested.parameters);
  }
}

/** Re-exported for step-shape convenience at call sites. */
export type { ResolutionPlanStep };
