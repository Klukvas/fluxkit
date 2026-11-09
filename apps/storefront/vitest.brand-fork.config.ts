import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The unit suite once more with a FILLED brand config (`src/lib/brand-fork-fixture.ts` in place of `src/config/brand.ts`), as a
 * fork that followed `docs/customization.md` has it (plan B1/B3: a rebrand needs no test edit). Part of `pnpm test`
 * (`package.json`). `config/brand.spec.ts` is left out: it checks the real file (its pictures must exist under `public/`).
 */
const fixture = fileURLToPath(new URL("./src/lib/brand-fork-fixture.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^(?:\.\.\/)+config\/brand$/, replacement: fixture }],
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", "src/config/brand.spec.ts"],
  },
});
