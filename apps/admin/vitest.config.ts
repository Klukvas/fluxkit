import { defineConfig } from "vitest/config";

// Node environment, no DOM: components are checked with `renderToStaticMarkup`, logic as pure functions (plan, owner
// answer 9). `build-output.spec.ts` reads `dist/` and needs `pnpm build` first (the root `pnpm test` builds).
export default defineConfig({
  test: {
    include: ["src/**/*.spec.{ts,tsx}", "*.spec.ts"],
  },
});
