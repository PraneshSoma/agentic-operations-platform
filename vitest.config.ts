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
      exclude: ["**/*.test.ts"],
    },
  },
});
