import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import {
  ADMIN_E2E_API_PORT,
  ADMIN_E2E_ORIGIN,
  ADMIN_E2E_PORT,
  SPA,
  apiEnvironment,
} from "./support/env.ts";

const adminRoot = resolve(import.meta.dirname, "..");
const apiOrigin = `http://127.0.0.1:${String(ADMIN_E2E_API_PORT)}`;

/**
 * End-to-end suite of the admin SPA (plan 2026-10-19-admin-ui.md, step 11; README in `e2e/`). Run with `pnpm test:e2e` from
 * the repository root (it builds first and runs the storefront suite before this one). Two servers are started here and
 * nothing is reused (`reuseExistingServer: false`: a leftover server could hide a broken start):
 *   1. the BUILT API on a wiped, migrated and seeded `*_e2e_test` database (`e2e/prepare-database.ts` runs first),
 *   2. `e2e/proxy.ts`, the same-origin proxy the browser talks to: the BUILT SPA under `/admin-ui` with its security
 *      headers, `/admin/*` and `/store/*` to the API (ADR 0027).
 * `global-setup.ts` then creates the manager and the viewer through the users API. `apiEnvironment()` throws before
 * anything starts when a required variable is missing.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  outputDir: "../test-results",
  globalSetup: "./global-setup.ts",
  // One worker, files and tests in order: the scenarios share one database (the seed, the three admins), and each test
  // creates the data it changes under its own unique codes, slugs and emails (support/unique.ts), so the order does not
  // matter for the result; one worker keeps the API's in-memory windows and the run time predictable.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env["CI"] !== undefined,
  retries: process.env["CI"] === undefined ? 0 : 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter:
    process.env["CI"] === undefined
      ? [["list"]]
      : [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  use: {
    baseURL: ADMIN_E2E_ORIGIN,
    // English UI: the SPA reads the browser language (owner answer 10); uk is covered by the language-switch scenario.
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
      cwd: adminRoot,
      env: { ...apiEnvironment() } as Record<string, string>,
      url: `${apiOrigin}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stderr: "pipe",
    },
    {
      name: "proxy",
      command: "node --experimental-strip-types e2e/proxy.ts",
      cwd: adminRoot,
      env: {
        ADMIN_E2E_PORT: String(ADMIN_E2E_PORT),
        ADMIN_E2E_API_PORT: String(ADMIN_E2E_API_PORT),
      },
      url: `${ADMIN_E2E_ORIGIN}${SPA}/`,
      timeout: 60_000,
      reuseExistingServer: false,
      stderr: "pipe",
    },
  ],
});
