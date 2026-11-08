import { defineConfig, devices } from "@playwright/test";
import e2eConfig from "./playwright.config.ts";
import { screenshotDirectory, screenshotTolerance } from "./support/visual/paths.ts";

/**
 * Visual harness of the design-changeability plan (`docs/plans/2026-11-08-design-changeability.md`, section 7; README in
 * `e2e/`, "Visual comparison"). The SAME stack as the e2e suite (`playwright.config.ts`: wiped and seeded `*_e2e_test`
 * database with the test fixture, built API, `next start` with no image hosts, the same-origin proxy), only other specs:
 *   - `tests/computed-styles.visual.ts`: the mandatory computed-style snapshot,
 *   - `tests/screenshots.visual.ts`: the secondary screenshots.
 * Normally run by `scripts/visual-compare.sh <base-ref>`, which runs it in the base tree and in this tree on one machine.
 */
const tolerance = screenshotTolerance();

export default defineConfig({
  ...e2eConfig,
  testMatch: "**/*.visual.ts",
  outputDir: "../test-results/visual",
  snapshotDir: screenshotDirectory(),
  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",
  // A missing baseline picture is a failure here, never a silently written new one; the base run passes
  // `--update-snapshots=all` on the command line, which takes precedence.
  updateSnapshots: "none",
  // No retries: a retried recording would hide a nondeterministic page, and the comparison must be deterministic.
  retries: 0,
  // The HTML report shows expected, actual and diff side by side; the script copies it into `.visual/report/`.
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report/visual" }]],
  expect: {
    ...e2eConfig.expect,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      ...(tolerance === "exact"
        ? { maxDiffPixels: 0 }
        : { maxDiffPixelRatio: 0.005, threshold: 0.2 }),
    },
  },
  use: { ...e2eConfig.use, reducedMotion: "reduce", trace: "retain-on-failure" },
  projects: [{ name: "visual", use: { ...devices["Desktop Chrome"], reducedMotion: "reduce" } }],
});
