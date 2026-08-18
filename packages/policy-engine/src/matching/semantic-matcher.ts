import type { IncomingRequest, OperationalProcedureContract } from "@aop/contracts";

/**
 * SemanticMatcher — scores how well one OPC fits an IncomingRequest,
 * beyond the exact category/application/severity filters (spec §6). Only
 * invoked when the exact filter leaves more than one candidate (spec §6's
 * matching strategy diagram) — with zero or one exact-filter survivor
 * there's nothing to disambiguate.
 *
 * Interface + pluggable-implementation pattern (see ADR-009/012 for the
 * precedent): a real LLM-backed semantic matcher is Investigator-agent
 * work (story B-05) and is out of scope here — this story only needs the
 * deterministic margin guardrail (spec §6A) around whatever score a
 * matcher produces, not the matcher's own sophistication.
 */
export interface SemanticMatcher {
  /** Returns a similarity score in [0, 1] — never negative, never above 1. */
  score(request: IncomingRequest, opc: OperationalProcedureContract): number;
}

/**
 * Deterministic word-overlap (Jaccard similarity) matcher — compares the
 * request's subject+description against the OPC's name +
 * match.semantic_description. Good enough to exercise and test the margin
 * guardrail deterministically; not a claim of semantic understanding.
 */
export class TextOverlapSemanticMatcher implements SemanticMatcher {
  score(request: IncomingRequest, opc: OperationalProcedureContract): number {
    const requestTokens = tokenize(`${request.subject} ${request.description}`);
    const opcTokens = tokenize(`${opc.name} ${opc.match.semantic_description ?? ""}`);

    if (requestTokens.size === 0 || opcTokens.size === 0) return 0;

    let intersectionSize = 0;
    for (const token of requestTokens) {
      if (opcTokens.has(token)) intersectionSize++;
    }
    // Both sets are non-empty past the guard above, so unionSize is always > 0.
    const unionSize = requestTokens.size + opcTokens.size - intersectionSize;
    return intersectionSize / unionSize;
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
}
