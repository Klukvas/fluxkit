import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The unit suite once more with FILLED fork-owned configs, as a fork that followed `docs/customization.md` has them: the brand
 * (`src/lib/brand-fork-fixture.ts` in place of `src/config/brand.ts`, plan B1/B3: a rebrand needs no test edit), the header
 * (`src/lib/header-fork-fixture.ts` in place of `src/config/header.ts`) and the footer (`src/lib/footer-fork-fixture.ts` in
 * place of `src/config/footer.ts`: the guide's four-column recipe, navigation and contacts in footer columns), plan L3: another
 * order, category count and footer blocks need no test edit; every UI slot (`src/lib/slots-fork-fixture.tsx` in place of
 * `src/config/slots.tsx`, plan S1) and a `grid` card of the fork's own (`src/lib/cards-fork-fixture.tsx` in place of
 * `src/components/cards/custom.ts`, plan L2). The specs that pin the template's own output mock those files back to the
 * template defaults (`src/test-support/template-defaults.ts`), so the run proves that the guide's mechanisms need no test
 * edit (A1 acceptance runs, PR-I2b). The DEFAULT home page is kept, with the fork run's message extras
 * (`src/lib/messages-extra-fork-run.*.ts`: the real extras plus the fixtures' `custom.` texts). Part of `pnpm test`
 * (`package.json`). Left out: `config/brand.spec.ts` (it checks the real file: its pictures must exist under `public/`), the
 * TEMPLATE-DEFAULT checks of the default header and footer markup and of the empty slots registry, `messages/message-files.spec.ts`
 * and `next.config.spec.ts` (they compare the real extras files on disk with the imported ones), and `*.fork.spec.{ts,tsx}`
 * (they belong to `vitest.home-fork.config.ts`).
 */
const brandFixture = fileURLToPath(new URL("./src/lib/brand-fork-fixture.ts", import.meta.url));
const headerFixture = fileURLToPath(new URL("./src/lib/header-fork-fixture.ts", import.meta.url));
const footerFixture = fileURLToPath(new URL("./src/lib/footer-fork-fixture.ts", import.meta.url));
const cardsFixture = fileURLToPath(new URL("./src/lib/cards-fork-fixture.tsx", import.meta.url));
const slotsFixture = fileURLToPath(new URL("./src/lib/slots-fork-fixture.tsx", import.meta.url));
const extras = fileURLToPath(new URL("./src/lib/messages-extra-fork-run.", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^(?:\.\.\/)+config\/brand$/, replacement: brandFixture },
      // Two modules, as in a fork: a spec that mocks one of them keeps the other.
      { find: /^(?:\.\.\/)+config\/header$/, replacement: headerFixture },
      { find: /^(?:\.\.\/)+config\/footer$/, replacement: footerFixture },
      // `./custom` from `components/cards/` (the registry), `./cards/custom` from `components/`, and from deeper folders.
      {
        find: /^(?:\.\/(?:cards\/)?|(?:\.\.\/)+components\/cards\/)custom$/,
        replacement: cardsFixture,
      },
      { find: /^(?:\.\.\/)+config\/slots$/, replacement: slotsFixture },
      { find: /^\.\.\/messages-extra\/(uk|en)\.json$/, replacement: `${extras}$1.ts` },
    ],
  },
  test: {
    // Checked by `src/lib/fork-run.spec.ts`: the aliases above really swap the configs in this run.
    provide: { forkRun: "brand-layout" },
    exclude: [
      ...configDefaults.exclude,
      "e2e/**",
      "src/config/brand.spec.ts",
      // TEMPLATE-DEFAULT CHECKS: the default header and footer markup (the text logo included), the empty slots registry,
      // the empty card registry.
      "src/components/header-footer-defaults.upstream.spec.tsx",
      "src/config/slots.upstream.spec.ts",
      "src/components/cards/custom.upstream.spec.ts",
      "src/messages/message-files.spec.ts",
      "next.config.spec.ts",
      "src/**/*.fork.spec.{ts,tsx}",
    ],
  },
});
