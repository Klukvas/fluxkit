import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // The seeded property specs (tens of thousands of cases against a BigInt reference) take about 5 s on a slow CI runner,
    // the Vitest default; the case counts stay, the limit is explicit (the same reasoning as `apps/api`).
    testTimeout: 30000,
  },
});
