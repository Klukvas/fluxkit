import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The unit suite once more with FILLED fork-owned configs, as a fork that followed `docs/customization.md` has them: the brand
 * (`src/lib/brand-fork-fixture.ts` in place of `src/config/brand.ts`, plan B1/B3: a rebrand needs no test edit) and the header
 * and footer (`src/lib/layout-fork-fixture.ts` in place of `src/config/header.ts` and `src/config/footer.ts`, plan L3: another
 * order, category count and link groups need no test edit). Part of `pnpm test` (`package.json`). Left out:
 * `config/brand.spec.ts` (it checks the real file: its pictures must exist under `public/`) and the TEMPLATE-DEFAULT check of
 * the default header and footer markup.
 */
const brandFixture = fileURLToPath(new URL("./src/lib/brand-fork-fixture.ts", import.meta.url));
const layoutFixture = fileURLToPath(new URL("./src/lib/layout-fork-fixture.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^(?:\.\.\/)+config\/brand$/, replacement: brandFixture },
      { find: /^(?:\.\.\/)+config\/(?:header|footer)$/, replacement: layoutFixture },
    ],
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      "e2e/**",
      "src/config/brand.spec.ts",
      // TEMPLATE-DEFAULT CHECK: pins the default header and footer markup (the text logo included).
      "src/components/header-footer-defaults.spec.tsx",
    ],
  },
});
