import {
  ResolutionPlanSchema,
  type ActionDefinition,
  type InvestigationResult,
  type LLMProvider,
  type OperationalProcedureContract,
  type ResolutionPlan,
} from "@aop/contracts";

/**
 * Thrown when a proposed ACTION step references an action_ref not present
 * in the available actions passed to the Planner — the Planner-side
 * analogue of the Investigator's "may not invent connector results"
 * (spec §11), applied to spec §12's Action Registry input: a plan cannot
 * propose an action that isn't actually registered.
 */
export class UnregisteredActionError extends Error {
  constructor(public readonly action_ref: string) {
    super(`Planner proposed action_ref "${action_ref}" which is not in the available actions`);
    this.name = "UnregisteredActionError";
  }
}

function buildSystemPrompt(opc: OperationalProcedureContract, availableActions: readonly ActionDefinition[]): string {
  return [
    `You are the Planner agent for the Operational Procedure Contract "${opc.name}" (${opc.opc_id}).`,
    `Allowed action_refs for this OPC: ${opc.actions.allowed_action_refs.join(", ") || "(none declared)"}`,
    `Available registered actions: ${availableActions.map((a) => a.action_id).join(", ") || "(none available)"}`,
    "",
    "Respond with a single JSON object matching the ResolutionPlan schema exactly " +
      "(plan_id, diagnosis_ref, steps, expected_outcome, rollback_strategy?, unresolved_risks). " +
      "Every step of type ACTION must set action_ref to one of the available registered actions above " +
      "— never propose an action_ref that isn't listed.",
  ].join("\n");
}

function buildUserPrompt(investigation: InvestigationResult): string {
  return JSON.stringify({ investigation }, null, 2);
}

export interface RunPlanningInput {
  investigation: InvestigationResult;
  opc: OperationalProcedureContract;
  availableActions: readonly ActionDefinition[];
  llmProvider: LLMProvider;
}

/**
 * runPlanning — spec §12's Planner Agent (story B-06). Calls the injected
 * LLMProvider, validates the response against ResolutionPlanSchema, then
 * checks every ACTION step's action_ref against the available actions
 * (analogous to the Investigator's evidence-grounding check).
 *
 * "Action Registry" and "Tenant Policy" (spec §12's other two inputs)
 * are deliberately narrowed here: a proper Action Registry interface is
 * C-02's job, and tenant-policy-aware planning constraints are C-03's —
 * neither contract exists yet, and guessing their shape now would risk
 * having to rework this call site later. `availableActions` (a plain
 * ActionDefinition list) is what this story actually needs to satisfy
 * its two acceptance criteria.
 */
export async function runPlanning(input: RunPlanningInput): Promise<ResolutionPlan> {
  const completion = await input.llmProvider.complete({
    systemPrompt: buildSystemPrompt(input.opc, input.availableActions),
    userPrompt: buildUserPrompt(input.investigation),
  });

  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(completion.text);
  } catch {
    throw new Error(`Planner response was not valid JSON: ${completion.text.slice(0, 200)}`);
  }

  const parsed = ResolutionPlanSchema.safeParse(rawParsed);
  if (!parsed.success) {
    throw new Error(`Planner response failed ResolutionPlan validation: ${parsed.error.message}`);
  }

  const registeredActionRefs = new Set(input.availableActions.map((a) => a.action_id));
  for (const step of parsed.data.steps) {
    if (step.type === "ACTION" && step.action_ref && !registeredActionRefs.has(step.action_ref)) {
      throw new UnregisteredActionError(step.action_ref);
    }
  }

  return parsed.data;
}
