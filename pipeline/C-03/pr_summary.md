# C-03: Policy Engine — two-phase evaluation, fixed hard-deny checks, fail-closed

**Phase:** C — Identity & Governance
**Depends on:** A-01, C-01
**Status:** DONE

## Summary

`packages/policy-engine/src/{hard-deny,rule-matching,evaluate-policy}.ts`:
LLD-v1 §3's two-phase Policy Engine design. Phase 1 runs the fixed,
non-tenant-configurable `HARD_DENY_CHECKS` (ADR-008's 7 conditions);
Phase 2 evaluates tenant `PolicyRule`s. Any exception anywhere in either
phase fails closed to `DENY(POLICY_EVALUATION_FAILED)`.

## Contract gaps closed

- **`PolicyRuleSchema`** (spec §16) — referenced by this story, had no schema anywhere yet.
- **`HardDenyReasonCodeSchema`/`HardDenyReasonCode`** — was inlined only inside `PolicyDecisionSchema`; extracted to a standalone export (additive, no value changed) since `packages/policy-engine`'s hard-deny checks need it as a reusable type.

## Design decisions

- **`evaluatePolicy()` is a pure function.** `decisionId` and `createdAt`
  are caller-supplied, not generated inside the function — that's what
  makes NFR-05 ("same `ProposedAction` + policy version evaluated twice
  produces a byte-identical `PolicyDecision`") a structural property
  rather than something only true "most of the time." The determinism
  tests call `evaluatePolicy(sameInput)` twice and assert
  `JSON.stringify()` equality, on the `ALLOW`, hard-deny, and
  fail-closed paths alike.
- **`policyRules` is typed `unknown`, parsed inside the try block.**
  Tenant-authored config may not be pre-validated at the point
  `evaluatePolicy` is called; parsing it with `PolicyRuleSchema` array
  validation inside the single try/catch is both CONTEXT.md RULE 1 (parse
  at the boundary) and the exact mechanism that turns a malformed rule
  into `DENY(POLICY_EVALUATION_FAILED)` instead of an uncaught throw.
- **`IMMUTABLE_POLICY_VIOLATION` is Phase 1, even though its data is
  tenant-authored.** ADR-008 names "a rule the tenant has marked
  non-overridable in policy config" as one of the 7 hard-deny conditions
  — a genuine tension with "Phase 1 is fixed, non-tenant-configurable."
  Resolved by making the *check* fixed code (walks the rule set for
  `immutable: true` entries, runs before any ordinary Phase 2 rule, and
  its `DENY` cannot be relaxed by any other rule) while the individual
  rule *data* stays tenant-authored — `PolicyRuleSchema.immutable` is a
  new additive field operationalizing a concept ADR-008 named but didn't
  give a field name to (disclosed explicitly in that schema's own doc
  comment).
- **No tenant-rule match defaults to `REQUIRE_APPROVAL`**, not `ALLOW` or
  `DENY` — an unconfigured tenant gets routed to a human, never
  auto-executed and never blocked outright (`DENY` outside Phase 1 is
  reserved for an explicit tenant `DENY` rule).
- **Effective risk class** uses the resolved `ActionDefinition.default_risk_class`
  when the action is registered, falling back to the proposal's own
  `requested_risk_class` only on the hard-deny path where no
  `ActionDefinition` was found (spec §15's full effective-risk computation
  — incorporating parameters/blast_radius/policy_tags/evidence_history —
  isn't named in C-03's 5 acceptance criteria and isn't attempted here).

## Files

- `packages/contracts/src/schemas/policy-rule.ts` (+ test).
- `packages/contracts/src/schemas/policy-decision.ts` — extracted `HardDenyReasonCodeSchema` (additive).
- `packages/policy-engine/src/hard-deny.ts` (+ test) — the fixed 7-check list.
- `packages/policy-engine/src/rule-matching.ts` (+ test) — shared `when`-matching logic.
- `packages/policy-engine/src/evaluate-policy.ts` (+ test) — the two-phase evaluator, the core of this story.

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 47 test files, 392 tests, all passed
coverage         → 100% statements/branches/functions/lines, every file in the repo
```

## Acceptance criteria

- [x] `HARD_DENY_CHECKS` is a fixed, code-level list in `packages/policy-engine/src/hard-deny.ts` — not loaded from tenant config (LLD §3, gate 4) — verified structurally (a plain exported `const` array, 7 entries, no config-loading path)
- [x] `test_hardDeny_cannotBeOverriddenByAnyPolicyRule()` passes: a tenant policy trying to `ALLOW` an unregistered action still returns `DENY` — implemented as a literally-named function, invoked from an `it()` block
- [x] Any evaluation exception/timeout/malformed-rule/missing-input resolves to `DENY(POLICY_EVALUATION_FAILED)`, never `REQUIRE_APPROVAL` — three separate `CRITICAL`-labeled tests (malformed rule via schema validation failure, missing input via a genuinely malformed nested object, and a non-array `policyRules`)
- [x] `PolicyDecision.requires_proposer_approver_separation` set from any matched rule that sets it (consumed later by C-04, not enforced here) — verified both when a rule sets it and when it defaults to `false`
- [x] Same `ProposedAction` + policy version evaluated twice produces a byte-identical `PolicyDecision` (NFR-05) — verified via `evaluatePolicy`'s purity on the `ALLOW`, hard-deny, and fail-closed paths
