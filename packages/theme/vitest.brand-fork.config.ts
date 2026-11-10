import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The theme specs once more as a fork that followed `docs/customization.md` has them: a FILLED storefront overrides file
 * (`src/fork-fixture/brand-overrides.css`, the A1 "Verde Kopi" rebrand) and a filled admin overrides file
 * (`src/fork-fixture/admin-overrides.css`), with `tokens.css` untouched, and the two literal copies such a fork still updates by
 * hand (`src/fork-fixture/email-theme.ts` and `src/fork-fixture/theme-color.ts` in place of `src/email-theme.ts` and
 * `src/theme-color.ts`: mail and `<meta name="theme-color">` cannot read CSS). Part of `pnpm test` (`package.json`).
 * `src/fork-run.spec.ts` checks that this run really reads the fixtures. Left out: the upstream-only `*.upstream.spec.ts`
 * (they pin the template's empty files; a fork deletes them).
 */
const fixture = (name: string) =>
  fileURLToPath(new URL(`./src/fork-fixture/${name}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^\.\/email-theme\.js$/, replacement: fixture("email-theme.ts") },
      { find: /^\.\/theme-color\.js$/, replacement: fixture("theme-color.ts") },
    ],
  },
  test: {
    exclude: [...configDefaults.exclude, "src/**/*.upstream.spec.ts"],
    provide: {
      themeRun: "brand-fork",
      brandOverridesFile: fixture("brand-overrides.css"),
      adminOverridesFile: fixture("admin-overrides.css"),
    },
  },
});
