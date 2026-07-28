import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/app/(app)/**/page.tsx"],
    rules: {
      "max-lines": ["error", { max: 1200, skipBlankLines: true, skipComments: true }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // A nested checkout is not this checkout. A `git worktree` created from
    // this directory rather than the repo root lands at
    // `.claude/worktrees/<name>/`, and lint would then walk that tree —
    // including its build output — and report errors from a branch nobody is
    // running. Mirrors the same exclusion in vitest.config.ts.
    ".claude/**",
  ]),
]);

export default eslintConfig;
