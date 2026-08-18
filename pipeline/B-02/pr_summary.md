# B-02: OPC matcher + deterministic margin guardrail

**Phase:** B — Happy-path runtime
**Depends on:** A-02
**Status:** DONE

## Summary

First code in a new `packages/policy-engine` package (CONTEXT.md's stated
home for OPC-match margin guardrail logic). Implements spec §6's Request
Router matching strategy (exact deterministic filter, then semantic
fallback only when the filter leaves multiple candidates) and spec §6A's
margin guardrail on top of it.

## Design decisions

- **`SemanticMatcher` interface + `TextOverlapSemanticMatcher`.** A real
  LLM-backed semantic matcher is Investigator-agent work (B-05), out of
  scope here. `TextOverlapSemanticMatcher` is a deterministic Jaccard
  word-overlap scorer — enough to exercise and test the margin guardrail
  deterministically, explicitly not a claim of semantic understanding.
  Swappable without touching `matchOpc()` or its callers.
- **`OpcMatchEvidenceSink` interface + `InMemoryOpcMatchEvidenceSink`.**
  Same pluggable pattern as B-01's `RawPayloadStore` (and ADR-009/012's
  precedent) — the real backing store is an Evidence Ledger write, wired
  in E-01.
- **Exact filter semantics** (undocumented at the field level by spec §6,
  so stated explicitly in code comments): a request label that's absent
  doesn't constrain that dimension; a label that IS present must appear in
  the OPC's declared `match` set for that dimension, so an OPC that
  declares no eligibility for a dimension the request specifies is not a
  candidate.
- **0 candidates / 1 candidate / 2+ candidates are three distinct paths**,
  matching spec §6's diagram exactly: 0 → `AMBIGUOUS_ESCALATE` with no
  invented OPC; 1 → `MATCHED` directly, semantic matcher never invoked,
  no `match_margin` (nothing to compare against); 2+ → semantic-scored,
  margin-gated.
- Fixed two pre-existing coverage gaps in `packages/evidence-ledger` (A-03)
  and now `packages/policy-engine`'s own barrel: added a trivial
  `index.test.ts` per package (same pattern `packages/contracts/src/index.test.ts`
  already established) so the re-export barrel's lines actually execute
  under coverage instead of sitting at 0%.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 24 test files, 210 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] Exact-filter matching plus margin-bounded semantic fallback works against one configured OPC (F-02 MVP) — `opc-matcher.test.ts`
- [x] An intentionally ambiguous ticket (margin below `minimum_required_margin`) yields `AMBIGUOUS_ESCALATE`, never an auto-pick — `CRITICAL`-labeled test, margin 0.04 against a 0.15 threshold, `selected_opc_id` asserted `undefined`
- [x] `OPCMatchResult` (all candidates) written to the Evidence Ledger unconditionally — verified on both the `MATCHED` and `AMBIGUOUS_ESCALATE` paths via the injected sink
