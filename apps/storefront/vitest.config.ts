import { configDefaults, defineConfig } from "vitest/config";

// The Playwright suite in `e2e/` has its own runner (`pnpm test:e2e`). Its files are named `*.e2e.ts`, which the default
// include pattern would not match anyway; the exclusion keeps it that way if a helper is ever named `*.spec.ts`.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
