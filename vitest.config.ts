import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "loop/modes/**"],
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.ts", "apps/**/src/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
});
