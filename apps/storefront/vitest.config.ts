import { configDefaults, defineConfig } from "vitest/config";

// The Playwright suite in `e2e/` has its own runner (`pnpm test:e2e`). Its files are named `*.e2e.ts`, which the default
// include pattern would not match anyway; the exclusion keeps it that way if a helper is ever named `*.spec.ts`.
// `*.fork.spec.{ts,tsx}` run only with `vitest.home-fork.config.ts` (they need its filled fork fixture).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", "src/**/*.fork.spec.{ts,tsx}"],
    // `forkRun`: read by `src/lib/fork-run.spec.ts`, the canary of the fork runs (`vitest.brand-fork.config.ts`,
    // `vitest.home-fork.config.ts`): this run reads the real fork-owned configs.
    provide: { forkRun: "none" },
  },
});
