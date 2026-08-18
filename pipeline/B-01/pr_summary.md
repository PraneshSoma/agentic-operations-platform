# B-01: Webhook trigger adapter + IncomingRequest normalization

**Phase:** B — Happy-path runtime
**Depends on:** A-01
**Status:** DONE

## Summary

First runtime code in the repo (and the first `apps/*` package —
`apps/api` didn't exist before this story). A Fastify route
(`POST /webhooks/:tenantId`) accepts any JSON body from a webhook source,
normalizes it into a schema-valid `IncomingRequest` via a trigger adapter,
and preserves the raw payload separately (spec §4.1's rules) instead of
inlining it.

## Design decisions

- **No `@fastify/type-provider-zod`.** The only published version
  (`1.0.0`) requires `zod >=4.2.0` and `fastify ^5.5.0`. Every contract in
  `@aop/contracts` is already built and ACCEPTED against Zod 3, across 174
  passing tests — not worth a breaking Zod-4 cascade for one route
  package. Validation is plain `Schema.safeParse()` inside the route
  handler instead, which is exactly CONTEXT.md RULE 1's requirement
  ("Runtime input ... MUST be parsed through the schema at the boundary")
  — the type-provider package is a DX convenience on top of that, not a
  requirement.
- **`RawPayloadStore` interface + `InMemoryRawPayloadStore`.** Mirrors the
  pattern ADR-009 (`SecretResolver`) and ADR-012 (`IdentityResolver`)
  already established for pluggable I/O: ship a working local
  implementation now, let the real backing store land without touching
  callers. The real store is the Evidence Ledger, as an `Evidence` record
  of `type: "REQUEST"` — spec §4.6 already names that enum value for
  exactly this — wired up in E-01 (Evidence Ledger persistence).
- **No `tsconfig.json` project reference to `packages/contracts`.**
  Adding one reproduces a `tsc -b --noEmit` error (`TS6310: Referenced
  project ... may not disable emit`) that also hit `packages/evidence-ledger`
  in A-03 — a diamond in the reference graph (root → apps/api → contracts,
  and root → contracts directly) conflicts with `--noEmit`. Plain pnpm
  workspace module resolution already resolves `@aop/contracts` correctly
  (its `package.json` points `types` straight at `src/index.ts`), so the
  reference isn't needed for type-checking to work — confirmed by
  `pnpm typecheck` passing clean without it.
- **No Zod re-validation of `:tenantId`.** Fastify's router already
  requires a non-empty path segment to match `/webhooks/:tenantId` at
  all — a param-shape check in the handler would be unreachable dead code,
  not real validation, and unreachable code is worse than no code.

## Files

- `apps/api/package.json`, `tsconfig.json` — new package.
- `apps/api/src/app.ts` — app factory (`buildApp()`), never calls `.listen()` — lets tests use Fastify's `.inject()`.
- `apps/api/src/index.ts` — the actual process entrypoint; only this file calls `.listen()`.
- `apps/api/src/routes/webhooks.ts` — the `POST /webhooks/:tenantId` route.
- `apps/api/src/triggers/webhook-adapter.ts` — `normalizeWebhookRequest()`, the pure normalization function.
- `apps/api/src/triggers/raw-payload-store.ts` — `RawPayloadStore` interface + `InMemoryRawPayloadStore`.
- Corresponding `*.test.ts` for all four testable files.

## Verification (real, not self-reported)

Beyond the automated suite, booted the actual server (`node --import tsx
src/index.ts`) and sent it a live `curl` POST:

```
$ curl -s -X POST http://localhost:3000/webhooks/tenant_1 \
    -H "Content-Type: application/json" \
    -d '{"subject":"smoke test","labels":{"severity":"P2"}}'
{"request_id":"dc5a41b2-f196-4c1a-9290-1ae0b1ddfdf0","received_at":"2026-08-18T10:56:39.055Z"}
HTTP 202
```

## Gate results

```
pnpm typecheck   → clean, exit 0
pnpm lint        → clean, exit 0
pnpm test        → 19 test files, 190 tests, all passed
coverage         → 100% on every apps/api file (index.ts — the .listen()-calling
                    entrypoint — is excluded from coverage, same convention as
                    any process entrypoint; verified separately via the curl
                    smoke test above, not via unit coverage)
```

## Acceptance criteria

- [x] A webhook POST produces a schema-valid `IncomingRequest` (F-01 MVP) — verified both by test and by the live curl smoke test
- [x] Raw trigger payload preserved separately via `raw_payload_ref` — verified: `webhook-adapter.test.ts` confirms the raw payload round-trips through the store and is retrievable only via the returned ref, never inlined
- [x] No trigger-specific field readable outside the trigger adapter — verified: a `CRITICAL`-labeled test asserts the normalized object's key set exactly equals `IncomingRequestSchema`'s own key set, with injected trigger-specific noise fields absent
