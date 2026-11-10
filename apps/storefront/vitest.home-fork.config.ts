import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The unit suite once more as a fork that reshaped its home page has it (plan 2026-11-08-design-changeability.md section 1,
 * request 4, and L4): `src/lib/home-config-fork-fixture.ts` in place of `config/home.ts` (a full-width custom section first,
 * a contained one later), `src/lib/home-fork-fixture.tsx` in place of `config/custom-sections.ts` (a filled registry), and
 * `src/lib/messages-extra-fork-run.*.ts` in place of `src/messages-extra/*.json`: the REAL extras with the fixture's `custom.`
 * texts merged over them, so a fork's own sections keep their texts here too. Plus `*.fork.spec.{ts,tsx}`, which render that
 * page. Part of `pnpm test` (`package.json`). Upstream pins of the default page skip themselves here
 * (`lib/home-template-default.ts`). Left out: `*.upstream.spec.ts` (upstream-only, fork-deletable: they require the template's
 * default page), `messages/message-files.spec.ts` and `next.config.spec.ts`, which read the real extras files from disk and
 * compare them with what the app imports (here the merge; in a real fork both are the same file).
 */
const registry = fileURLToPath(new URL("./src/lib/home-fork-fixture.tsx", import.meta.url));
const home = fileURLToPath(new URL("./src/lib/home-config-fork-fixture.ts", import.meta.url));
const extras = fileURLToPath(new URL("./src/lib/messages-extra-fork-run.", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^(?:\.\.\/)+config\/custom-sections$/, replacement: registry },
      { find: /^(?:\.\.\/)+config\/home$|^\.\/home$/, replacement: home },
      { find: /^\.\.\/messages-extra\/(uk|en)\.json$/, replacement: `${extras}$1.ts` },
    ],
  },
  test: {
    // Checked by `src/lib/fork-run.spec.ts`: the aliases above really swap the home configs in this run.
    provide: { forkRun: "home" },
    exclude: [
      ...configDefaults.exclude,
      "e2e/**",
      "src/**/*.upstream.spec.{ts,tsx}",
      "src/messages/message-files.spec.ts",
      "next.config.spec.ts",
    ],
  },
});
