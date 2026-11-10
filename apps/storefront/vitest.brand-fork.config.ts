import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The unit suite once more with FILLED fork-owned configs, as a fork that followed `docs/customization.md` has them: the brand
 * (`src/lib/brand-fork-fixture.ts` in place of `src/config/brand.ts`, plan B1/B3: a rebrand needs no test edit), the header
 * and footer (`src/lib/layout-fork-fixture.ts` in place of `src/config/header.ts` and `src/config/footer.ts`, plan L3: another
 * order, category count and link groups need no test edit) and every UI slot (`src/lib/slots-fork-fixture.tsx` in place of
 * `src/config/slots.tsx`, plan S1) while the DEFAULT home page is kept, with the fork run's message extras
 * (`src/lib/messages-extra-fork-run.*.ts`: the real extras plus the fixtures' `custom.` texts). Part of `pnpm test`
 * (`package.json`). Left out: `config/brand.spec.ts` (it checks the real file: its pictures must exist under `public/`), the
 * TEMPLATE-DEFAULT checks of the default header and footer markup and of the empty slots registry, `messages/message-files.spec.ts`
 * and `next.config.spec.ts` (they compare the real extras files on disk with the imported ones), and `*.fork.spec.{ts,tsx}`
 * (they belong to `vitest.home-fork.config.ts`).
 */
const brandFixture = fileURLToPath(new URL("./src/lib/brand-fork-fixture.ts", import.meta.url));
const layoutFixture = fileURLToPath(new URL("./src/lib/layout-fork-fixture.ts", import.meta.url));
const slotsFixture = fileURLToPath(new URL("./src/lib/slots-fork-fixture.tsx", import.meta.url));
const extras = fileURLToPath(new URL("./src/lib/messages-extra-fork-run.", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^(?:\.\.\/)+config\/brand$/, replacement: brandFixture },
      { find: /^(?:\.\.\/)+config\/(?:header|footer)$/, replacement: layoutFixture },
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
      // TEMPLATE-DEFAULT CHECKS: the default header and footer markup (the text logo included), the empty slots registry.
      "src/components/header-footer-defaults.upstream.spec.tsx",
      "src/config/slots.upstream.spec.ts",
      "src/messages/message-files.spec.ts",
      "next.config.spec.ts",
      "src/**/*.fork.spec.{ts,tsx}",
    ],
  },
});
