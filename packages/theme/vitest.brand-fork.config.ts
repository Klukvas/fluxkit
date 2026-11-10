import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The theme specs once more as a fork that followed `docs/customization.md` has them: a FILLED storefront overrides file
 * (`src/fork-fixture/brand-overrides.css`, the A1 "Verde Kopi" rebrand) and a filled admin overrides file
 * (`src/fork-fixture/admin-overrides.css`), with `tokens.css` untouched. Part of `pnpm test` (`package.json`).
 * `src/fork-run.spec.ts` checks that this run really reads the fixtures. Left out: the upstream-only `*.upstream.spec.ts`
 * (they pin the template's empty files; a fork deletes them).
 */
const fixture = (name: string) =>
  fileURLToPath(new URL(`./src/fork-fixture/${name}`, import.meta.url));

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "src/**/*.upstream.spec.ts"],
    provide: {
      themeRun: "brand-fork",
      brandOverridesFile: fixture("brand-overrides.css"),
      adminOverridesFile: fixture("admin-overrides.css"),
    },
  },
});
