import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The theme specs on the REAL fork-owned overrides files (empty upstream, a fork's own content in a fork). They are read through
 * `src/theme-run.testing.ts`; `vitest.brand-fork.config.ts` runs the same specs once more on filled fixtures.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude],
    provide: {
      themeRun: "upstream",
      brandOverridesFile: fileURLToPath(new URL("./src/brand-overrides.css", import.meta.url)),
      adminOverridesFile: fileURLToPath(new URL("./src/admin-overrides.css", import.meta.url)),
    },
  },
});
