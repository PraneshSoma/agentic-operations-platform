import { z } from "zod";

/** PreconditionSet — a small set of fields a plan requires still hold, checked immediately before execute() (spec §14B). */
export const PreconditionSetSchema = z.object({
  checks: z.array(
    z.object({
      field_ref: z.string(),
      expected_value: z.unknown(),
      tolerance: z.enum(["exact", "within_range", "unchanged_since"]),
    }),
  ),
});

/**
 * PreflightResult — DRIFTED blocks execution unconditionally; UNKNOWN
 * (the check itself failed) is treated as required-context-missing and
 * escalates — never an implicit pass (spec §14B).
 */
export const PreflightResultSchema = z.object({
  status: z.enum(["MATCH", "DRIFTED", "UNKNOWN"]),
  drifted_fields: z.array(
    z.object({
      field_ref: z.string(),
      expected: z.unknown(),
      observed: z.unknown(),
    }),
  ),
});

export type PreconditionSet = z.infer<typeof PreconditionSetSchema>;
export type PreflightResult = z.infer<typeof PreflightResultSchema>;
