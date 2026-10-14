import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/.next/**", "pnpm-lock.yaml"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "readonly", require: "readonly" },
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // AGENTS.md section 9: never mask failures.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-nocheck": true, "ts-expect-error": true, "ts-check": false },
      ],
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/no-non-null-assertion": "error",
      // Nest modules are decorated classes that carry metadata only.
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
    },
  },
);
