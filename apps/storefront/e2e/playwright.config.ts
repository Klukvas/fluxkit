import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import {
  E2E_API_PORT,
  E2E_ORIGIN,
  E2E_PORT,
  E2E_STOREFRONT_PORT,
  apiEnvironment,
} from "./support/env.ts";

const storefrontRoot = resolve(import.meta.dirname, "..");
const apiOrigin = `http://127.0.0.1:${String(E2E_API_PORT)}`;
const ports = {
  E2E_PORT: String(E2E_PORT),
  E2E_API_PORT: String(E2E_API_PORT),
  E2E_STOREFRONT_PORT: String(E2E_STOREFRONT_PORT),
};

/**
 * End-to-end suite of the storefront (plan 2026-10-18-storefront.md, step 8; README in `e2e/`). Run with `pnpm test:e2e`
 * from the repository root, after `pnpm build`. Three servers are started here, and nothing else is reused
 * (`reuseExistingServer: false`: a leftover server could hide a broken start):
 *   1. the BUILT API on a wiped, migrated and seeded `*_e2e_test` database (`e2e/prepare-database.ts` runs first),
 *   2. the BUILT storefront (`next start`),
 *   3. `e2e/proxy.ts`, the same-origin proxy the browser talks to (ADR 0026).
 * `apiEnvironment()` throws before anything starts when a required variable is missing.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  outputDir: "../test-results",
  // One worker, files and tests in order: the scenarios change shared catalog data (a price, the last unit of a product), so
  // they run one after the other and stay deterministic. Each test still has its own addresses and emails (e2e/support).
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env["CI"] !== undefined,
  retries: process.env["CI"] === undefined ? 0 : 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter:
    process.env["CI"] === undefined
      ? [["list"]]
      : [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  use: {
    baseURL: E2E_ORIGIN,
    locale: "en-US",
    timezoneId: "UTC",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Chromium only. The browser comes from PLAYWRIGHT_BROWSERS_PATH or Playwright's cache (`playwright install chromium`).
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "api",
      // Wipe, migrate, seed and create the owner, then become the API (exec: the server itself receives the shutdown signal).
      command:
        "node --experimental-strip-types e2e/prepare-database.ts && exec node ../api/dist/main.js",
      cwd: storefrontRoot,
      env: { ...apiEnvironment() } as Record<string, string>,
      url: `${apiOrigin}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stderr: "pipe",
    },
    {
      name: "storefront",
      // `next start` keeps its 60 s data cache ON DISK (`.next/cache/fetch-cache`), so a run that starts within a minute of the
      // last one would render product pages with the variant ids of the PREVIOUS seed (the API answers 404 for them). A
      // clean cache makes every run depend on this run's data only.
      command: `rm -rf .next/cache/fetch-cache && pnpm start -p ${String(E2E_STOREFRONT_PORT)} -H 127.0.0.1`,
      cwd: storefrontRoot,
      env: {
        API_INTERNAL_URL: apiOrigin,
        STOREFRONT_PUBLIC_URL: E2E_ORIGIN,
        STOREFRONT_IMAGE_HOSTS: "",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      // The home page reads the API on the server: this answers 200 only once the API is up too.
      url: `http://127.0.0.1:${String(E2E_STOREFRONT_PORT)}/en`,
      timeout: 180_000,
      reuseExistingServer: false,
      stderr: "pipe",
    },
    {
      name: "proxy",
      command: "node --experimental-strip-types e2e/proxy.ts",
      cwd: storefrontRoot,
      env: ports,
      url: `${E2E_ORIGIN}/store/config`,
      timeout: 180_000,
      reuseExistingServer: false,
      stderr: "pipe",
    },
  ],
});
