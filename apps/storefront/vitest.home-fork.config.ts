import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The unit suite once more with a FILLED `config/custom-sections.ts` (`src/lib/home-fork-fixture.tsx` in its place), as a fork
 * that registered a custom home section has it (plan 2026-11-08-design-changeability.md, L4), plus
 * `components/home-sections.fork.spec.tsx`, which renders the fixture's home config (`width: "full"` and a custom section).
 * Part of `pnpm test` (`package.json`). `components/home-sections-default.spec.tsx` is left out: it checks the template's
 * defaults (the empty registry, the frozen default markup).
 */
const fixture = fileURLToPath(new URL("./src/lib/home-fork-fixture.tsx", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^(?:\.\.\/)+config\/custom-sections$/, replacement: fixture }],
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", "src/components/home-sections-default.spec.tsx"],
  },
});
