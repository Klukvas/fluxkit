import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Geometry probe of the UI slots' fork fixture (plan 2026-11-08-design-changeability.md, S1; `docs/contracts/slots.md`): renders
 * `src/lib/slots-fork-fixture.tsx` on the grid card and in the four-column footer, with the storefront's real compiled CSS, in
 * Chromium at several widths, and asserts that nothing collides. LOCAL ONLY (not in `pnpm test` or CI): it needs a Chromium of
 * Playwright 1.64.1 (`PLAYWRIGHT_BROWSERS_PATH`), but no database. Run:
 *   pnpm --filter @fluxkit/storefront exec vitest run -c e2e/support/slots-geometry/vitest.config.ts
 */
const storefront = fileURLToPath(new URL("../../../", import.meta.url));
const slots = fileURLToPath(new URL("../../../src/lib/slots-fork-fixture.tsx", import.meta.url));
const extras = fileURLToPath(new URL("../../../src/lib/messages-extra-fork-run.", import.meta.url));

export default defineConfig({
  root: storefront,
  resolve: {
    alias: [
      { find: /^(?:\.\.\/)+config\/slots$/, replacement: slots },
      { find: /^\.\.\/messages-extra\/(uk|en)\.json$/, replacement: `${extras}$1.ts` },
    ],
  },
  test: {
    include: ["e2e/support/slots-geometry/*.spec.tsx"],
    // Processes `globals.css?inline` with the storefront's PostCSS config (Tailwind), as `next build` does.
    css: true,
    testTimeout: 120_000,
  },
});
