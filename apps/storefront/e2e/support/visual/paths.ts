import { resolve } from "node:path";

/**
 * Output locations of the visual harness. `scripts/visual-compare.sh` always sets both variables (absolute paths in the
 * PR tree's `.visual/`, also when the harness runs inside the base tree); the defaults serve a manual run from this tree.
 * Test-only variables, documented in `.env.example` and `e2e/README.md`; the shop never reads them.
 */
const repositoryRoot = resolve(import.meta.dirname, "../../../../..");

/** Where `toHaveScreenshot` reads (and with `--update-snapshots` writes) the baseline pictures. */
export function screenshotDirectory(): string {
  const value = process.env["VISUAL_SNAPSHOT_DIR"];
  return value === undefined || value === ""
    ? resolve(repositoryRoot, ".visual/baseline/screenshots")
    : resolve(value);
}

/** Where `computed-styles.visual.ts` writes its fragments. */
export function computedStylesDirectory(): string {
  const value = process.env["VISUAL_COMPUTED_DIR"];
  return value === undefined || value === ""
    ? resolve(repositoryRoot, ".visual/current/computed-styles")
    : resolve(value);
}

/**
 * `exact` (default): `maxDiffPixels: 0`. `ratio`: `maxDiffPixelRatio: 0.005` with `threshold: 0.2`, allowed only when the
 * PR attaches the diff images of an `exact` run (e2e README, "Screenshots"). Anything else is an error, not a silent default.
 */
export type ScreenshotTolerance = "exact" | "ratio";
export function screenshotTolerance(): ScreenshotTolerance {
  const value = process.env["VISUAL_TOLERANCE"];
  if (value === undefined || value === "" || value === "exact") return "exact";
  if (value === "ratio") return "ratio";
  throw new Error(`VISUAL_TOLERANCE must be "exact" or "ratio", not "${value}".`);
}

/** The effective exceptions the script writes next to the baseline pictures (masks apply on both sides). */
export function masksFile(): string {
  return resolve(screenshotDirectory(), "exceptions.json");
}
