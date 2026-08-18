import { OPCMatchResultSchema, type IncomingRequest, type OPCMatchResult, type OperationalProcedureContract } from "@aop/contracts";
import type { SemanticMatcher } from "./semantic-matcher.js";
import type { OpcMatchEvidenceSink } from "./opc-match-evidence-sink.js";

export interface MatchOpcOptions {
  /** Tenant-configured tolerance (spec §6A, e.g. 0.15). */
  minimumRequiredMargin: number;
  semanticMatcher: SemanticMatcher;
  evidenceSink: OpcMatchEvidenceSink;
}

/**
 * OPC exact-filter stage (spec §6's matching strategy: "Exact deterministic
 * filters -> category/application/severity"). A request label that is
 * absent doesn't constrain that dimension; a label that IS present must
 * appear in the OPC's declared match set for that dimension — an OPC that
 * declares no eligibility for a dimension the request does specify is not
 * a candidate.
 */
function passesExactFilter(request: IncomingRequest, opc: OperationalProcedureContract): boolean {
  if (opc.status !== "published") return false;
  if (opc.tenant_id !== request.tenant_id) return false;

  const { category, application, severity } = request.labels;
  if (category !== undefined && !opc.match.categories.includes(category)) return false;
  if (application !== undefined && !opc.match.applications.includes(application)) return false;
  if (severity !== undefined && !opc.match.severities.includes(severity)) return false;
  return true;
}

/**
 * matchOpc — spec §6's Request Router / OPC Matcher, plus §6A's
 * deterministic margin guardrail (story B-02).
 *
 * - 0 candidates survive the exact filter -> AMBIGUOUS_ESCALATE (spec §6's
 *   "If no OPC meets the minimum match policy: ESCALATE_TO_HUMAN. Do not
 *   invent an OPC dynamically.").
 * - Exactly 1 candidate -> MATCHED directly; nothing to disambiguate, so
 *   the semantic matcher is never invoked and there is no match_margin
 *   (there's no second candidate to measure a margin against).
 * - 2+ candidates -> every candidate is scored by the SemanticMatcher,
 *   sorted descending; if the top score's margin over the second-best is
 *   below minimumRequiredMargin, outcome is AMBIGUOUS_ESCALATE with NO
 *   selected_opc_id (spec §6A: "do not silently pick between two
 *   similarly-plausible OPCs either") — otherwise MATCHED, selecting the
 *   top candidate.
 *
 * The full OPCMatchResult — every candidate considered, not only the
 * winner — is recorded via evidenceSink.record() unconditionally, on
 * every branch above, before returning (spec §6A).
 */
export async function matchOpc(
  request: IncomingRequest,
  opcs: readonly OperationalProcedureContract[],
  options: MatchOpcOptions,
): Promise<OPCMatchResult> {
  const filtered = opcs.filter((opc) => passesExactFilter(request, opc));

  let result: OPCMatchResult;

  if (filtered.length === 0) {
    result = OPCMatchResultSchema.parse({
      request_id: request.request_id,
      candidates: [],
      minimum_required_margin: options.minimumRequiredMargin,
      outcome: "AMBIGUOUS_ESCALATE",
    });
  } else if (filtered.length === 1) {
    const only = filtered[0]!;
    result = OPCMatchResultSchema.parse({
      request_id: request.request_id,
      candidates: [{ opc_id: only.opc_id, opc_version: only.version, match_score: 1 }],
      selected_opc_id: only.opc_id,
      minimum_required_margin: options.minimumRequiredMargin,
      outcome: "MATCHED",
    });
  } else {
    const scored = filtered
      .map((opc) => ({ opc, match_score: options.semanticMatcher.score(request, opc) }))
      .sort((a, b) => b.match_score - a.match_score);
    const top = scored[0]!;
    const second = scored[1]!;
    const margin = top.match_score - second.match_score;
    const outcome = margin >= options.minimumRequiredMargin ? "MATCHED" : "AMBIGUOUS_ESCALATE";

    result = OPCMatchResultSchema.parse({
      request_id: request.request_id,
      candidates: scored.map((s) => ({
        opc_id: s.opc.opc_id,
        opc_version: s.opc.version,
        match_score: s.match_score,
      })),
      selected_opc_id: outcome === "MATCHED" ? top.opc.opc_id : undefined,
      match_margin: margin,
      minimum_required_margin: options.minimumRequiredMargin,
      outcome,
    });
  }

  // Unconditional — every branch above reaches this same line (spec §6A).
  await options.evidenceSink.record(request.tenant_id, result);
  return result;
}
