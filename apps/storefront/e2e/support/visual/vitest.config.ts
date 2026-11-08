import { defineConfig } from "vitest/config";

// Unit tests of the visual harness's pure parts (selector list, pages, snapshots, exceptions, diff and report). The
// storefront's own `vitest.config.ts` excludes `e2e/**`, so these run only with this config:
//   pnpm --filter @fluxkit/storefront exec vitest run -c e2e/support/visual/vitest.config.ts
// (CI: the `visual` job; README in `e2e/`, "Visual comparison").
export default defineConfig({
  test: { root: import.meta.dirname, include: ["*.spec.ts"] },
});
