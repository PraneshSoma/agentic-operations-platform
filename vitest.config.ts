import { defineConfig } from "vitest/config";

// Integration tests (@testcontainers/postgresql, etc. — anything that needs
// a real external service) are named *.integration.test.ts and excluded
// from the default `vitest run` / `pnpm test` gate, which stays fast and
// dependency-free. Run them explicitly with `pnpm test:integration`
// (requires a container runtime — see CONTEXT.md's stack decision).
const INTEGRATION_PATTERN = "**/*.integration.test.ts";

export default defineConfig({
  test: {
    environment: "node",
    include: process.env.VITEST_INTEGRATION
      ? [INTEGRATION_PATTERN]
      : ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: process.env.VITEST_INTEGRATION
      ? ["**/node_modules/**", "**/dist/**", "loop/modes/**"]
      : ["**/node_modules/**", "**/dist/**", "loop/modes/**", INTEGRATION_PATTERN],
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.ts", "apps/**/src/**/*.ts"],
      // apps/*/src/index.ts is a process entrypoint (calls .listen(),
      // process.exit()) — no business logic to verify, and not meaningfully
      // unit-testable without binding a real port. app.ts (the testable
      // factory it calls into) stays covered.
      //
      // llm-provider.ts / identity-resolver.ts are `export interface`/
      // `export type` only — TypeScript erases these entirely at compile
      // time, so the emitted JS module has zero executable statements.
      // There is nothing a test could exercise.
      exclude: [
        "**/*.test.ts",
        "apps/*/src/index.ts",
        "packages/contracts/src/llm-provider.ts",
        "packages/identity/src/identity-resolver.ts",
        // Prisma-backed repository: append-only-ness and cross-tenant
        // isolation are DB-level properties a dependency-free unit test
        // can't exercise. Verified by *.integration.test.ts against a real
        // Postgres (story E-01); the pure logic it delegates to
        // (buildSupersedingRecord, computeRetention) stays fully covered
        // in the default gate.
        "packages/evidence-ledger/src/repositories/prisma-evidence-repository.ts",
        // Prisma-bound outbox writer + store (story E-02): transaction
        // atomicity and the relay poll query are DB-level properties,
        // integration-tested against a real Postgres. The pure outbox
        // logic (buildOutboxEvent, relay-lag, OutboxRelay, dedup) stays
        // fully covered in the default gate.
        "packages/evidence-ledger/src/outbox/prisma-ledger-writer.ts",
        "packages/evidence-ledger/src/outbox/prisma-outbox-store.ts",
      ],
    },
  },
});
