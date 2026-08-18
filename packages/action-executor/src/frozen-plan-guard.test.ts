import { describe, expect, it } from "vitest";
import type { ResolutionPlan } from "@aop/contracts";
import { assertMatchesFrozenPlan, ParameterChangedError, UnapprovedActionError } from "./frozen-plan-guard.js";

const approvedPlan: ResolutionPlan = {
  plan_id: "plan_1",
  diagnosis_ref: "diag_1",
  steps: [
    { step_id: "step_1", type: "READ", description: "confirm state" },
    {
      step_id: "step_2",
      type: "ACTION",
      description: "restart the service",
      action_ref: "restart_service",
      parameters: { service: "checkout", region: "us-east-1" },
    },
    { step_id: "step_3", type: "VERIFY", description: "confirm recovery" },
  ],
  expected_outcome: "error rate returns to baseline",
  unresolved_risks: [],
};

describe("assertMatchesFrozenPlan", () => {
  it("does not throw when the requested step matches the approved plan exactly", () => {
    expect(() =>
      assertMatchesFrozenPlan(approvedPlan, {
        step_id: "step_2",
        action_ref: "restart_service",
        parameters: { service: "checkout", region: "us-east-1" },
      }),
    ).not.toThrow();
  });

  it("does not throw when parameters match regardless of key order (structural, not string, equality)", () => {
    expect(() =>
      assertMatchesFrozenPlan(approvedPlan, {
        step_id: "step_2",
        action_ref: "restart_service",
        parameters: { region: "us-east-1", service: "checkout" },
      }),
    ).not.toThrow();
  });

  it("CRITICAL (F-06): throws UnapprovedActionError when the step_id was never in the approved plan (an added step)", () => {
    expect(() =>
      assertMatchesFrozenPlan(approvedPlan, { step_id: "step_never_approved", action_ref: "restart_service" }),
    ).toThrow(UnapprovedActionError);
  });

  it("CRITICAL (F-06): throws UnapprovedActionError when the action_ref differs from the approved step's (a substituted action)", () => {
    expect(() =>
      assertMatchesFrozenPlan(approvedPlan, {
        step_id: "step_2",
        action_ref: "delete_deployment", // approved step_2 is restart_service
        parameters: { service: "checkout", region: "us-east-1" },
      }),
    ).toThrow(UnapprovedActionError);
  });

  it("CRITICAL: throws ParameterChangedError (never silently proceeds) when a parameter value changed", () => {
    expect(() =>
      assertMatchesFrozenPlan(approvedPlan, {
        step_id: "step_2",
        action_ref: "restart_service",
        parameters: { service: "checkout", region: "eu-west-1" }, // region changed
      }),
    ).toThrow(ParameterChangedError);
  });

  it("CRITICAL: throws ParameterChangedError when an extra parameter key was added", () => {
    expect(() =>
      assertMatchesFrozenPlan(approvedPlan, {
        step_id: "step_2",
        action_ref: "restart_service",
        parameters: { service: "checkout", region: "us-east-1", force: true },
      }),
    ).toThrow(ParameterChangedError);
  });

  it("throws ParameterChangedError when the approved step had parameters but the request omits them", () => {
    expect(() => assertMatchesFrozenPlan(approvedPlan, { step_id: "step_2", action_ref: "restart_service" })).toThrow(
      ParameterChangedError,
    );
  });

  it("ParameterChangedError carries both the approved and requested parameters for audit", () => {
    try {
      assertMatchesFrozenPlan(approvedPlan, {
        step_id: "step_2",
        action_ref: "restart_service",
        parameters: { service: "checkout", region: "eu-west-1" },
      });
      expect.fail("expected ParameterChangedError");
    } catch (err) {
      expect(err).toBeInstanceOf(ParameterChangedError);
      const e = err as ParameterChangedError;
      expect(e.approved_parameters).toEqual({ service: "checkout", region: "us-east-1" });
      expect(e.requested_parameters).toEqual({ service: "checkout", region: "eu-west-1" });
    }
  });

  it("nested object/array parameters are compared deeply, not by reference", () => {
    const planWithNested: ResolutionPlan = {
      ...approvedPlan,
      steps: [
        {
          step_id: "step_1",
          type: "ACTION",
          description: "x",
          action_ref: "bulk_update",
          parameters: { ids: [1, 2, 3], meta: { tag: "prod" } },
        },
      ],
    };
    expect(() =>
      assertMatchesFrozenPlan(planWithNested, {
        step_id: "step_1",
        action_ref: "bulk_update",
        parameters: { ids: [1, 2, 3], meta: { tag: "prod" } },
      }),
    ).not.toThrow();

    expect(() =>
      assertMatchesFrozenPlan(planWithNested, {
        step_id: "step_1",
        action_ref: "bulk_update",
        parameters: { ids: [1, 2, 4], meta: { tag: "prod" } }, // one array element changed
      }),
    ).toThrow(ParameterChangedError);

    // A value that was an array in the approved step but isn't in the
    // request (a type-shape change, not just a content change) is still
    // caught, not mistaken for a structurally-equal object.
    expect(() =>
      assertMatchesFrozenPlan(planWithNested, {
        step_id: "step_1",
        action_ref: "bulk_update",
        parameters: { ids: { 0: 1, 1: 2, 2: 3 }, meta: { tag: "prod" } },
      }),
    ).toThrow(ParameterChangedError);
  });

  it("an ACTION step approved with no parameters at all matches a request with no parameters", () => {
    const planWithNoParams: ResolutionPlan = {
      ...approvedPlan,
      steps: [{ step_id: "step_1", type: "ACTION", description: "x", action_ref: "noop_action" }],
    };
    expect(() => assertMatchesFrozenPlan(planWithNoParams, { step_id: "step_1", action_ref: "noop_action" })).not.toThrow();
  });
});
