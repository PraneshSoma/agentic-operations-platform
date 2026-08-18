import { z } from "zod";

/**
 * OPCMatchResult — the deterministic OPC-matching guardrail (spec §6A).
 * If the top candidate's margin over the second-best is below
 * minimum_required_margin, outcome is AMBIGUOUS_ESCALATE — never a silent
 * auto-pick between similarly-plausible OPCs. Written to the Evidence
 * Ledger unconditionally, including every candidate considered.
 */
export const OPCMatchResultSchema = z.object({
  request_id: z.string(),
  candidates: z.array(
    z.object({
      opc_id: z.string(),
      opc_version: z.string(),
      match_score: z.number(),
    }),
  ),
  selected_opc_id: z.string().optional(),
  match_margin: z.number().optional(),
  minimum_required_margin: z.number(),
  outcome: z.enum(["MATCHED", "AMBIGUOUS_ESCALATE"]),
});

export type OPCMatchResult = z.infer<typeof OPCMatchResultSchema>;
