import { defineConfig } from "vitest/config";

// Node environment, no DOM: components are checked with `renderToStaticMarkup`, logic as pure functions (plan, owner
// answer 9). `build-output.spec.ts` reads `dist/` and needs `pnpm build` first (the root `pnpm test` builds).
export default defineConfig({
  test: {
    include: ["src/**/*.spec.{ts,tsx}", "*.spec.ts"],
    // Seeded property specs (safe-next: 20 000 values) take a few seconds under the parallel load of `pnpm test`.
    testTimeout: 30_000,
    // Off: the cached transform of a file is keyed by its own content, so `src/features/registry.ts` (an
    // `import.meta.glob` of the slice folders) kept the slices of an earlier run after a folder was added or deleted
    // (measured with Vitest 5.0.5; the feature matrix deletes the slices, ADR 0049).
    fsModuleCache: false,
  },
});
