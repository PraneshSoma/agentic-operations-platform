// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "loop/modes/**",
      // loop/tools/generate.mjs is upstream framework tooling (a plain Node
      // script, not part of this product's TS app code) — copied verbatim
      // from agentic-sdlc-loop, not linted against this repo's app rules.
      "loop/tools/**",
      "**/*.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
