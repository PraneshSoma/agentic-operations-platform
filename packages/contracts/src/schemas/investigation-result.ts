import { z } from "zod";

/**
 * InvestigationResult (spec §11) — the Investigator Agent's output.
 * "The agent may not invent connector results. Every factual operational
 * claim must trace to evidence" — the evidence_ids arrays are how that
 * rule is checked (apps/worker/src/agents/investigator.ts, story B-05);
 * this schema only enforces the shape, not the grounding itself (a Zod
 * schema can't cross-reference an external evidence corpus).
 *
 * hypotheses[].status is a required, closed enum — every hypothesis MUST
 * be marked supported/rejected/unresolved explicitly (story B-05's second
 * acceptance criterion); there is no "unmarked" state representable here.
 */
export const InvestigationResultSchema = z.object({
  observations: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      evidence_ids: z.array(z.string()),
    }),
  ),

  hypotheses: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      supporting_evidence_ids: z.array(z.string()),
      contradicting_evidence_ids: z.array(z.string()),
      status: z.enum(["supported", "rejected", "unresolved"]),
    }),
  ),

  diagnosis: z.object({
    summary: z.string(),
    evidence_ids: z.array(z.string()),
  }),

  missing_information: z.array(z.string()),

  recommended_next_step: z.enum(["PLAN", "MORE_CONTEXT", "ESCALATE"]),
});

export type InvestigationResult = z.infer<typeof InvestigationResultSchema>;
