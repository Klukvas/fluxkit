import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_ORIGIN } from "../support/env.ts";
import { computedStylesOf, preparePage, setTheme, settle } from "../support/visual/browser.ts";
import { expect, test } from "../support/visual/fixture.ts";
import {
  COMPUTED_STYLE_MOBILE_PAGES,
  COMPUTED_STYLE_MOBILE_SELECTORS,
  COMPUTED_STYLE_MOBILE_VIEWPORT,
  COMPUTED_STYLE_PAGES,
  COMPUTED_STYLE_THEMES,
  COMPUTED_STYLE_VIEWPORT,
  missingRequiredSelectors,
  type VisualPage,
} from "../support/visual/pages.ts";
import { computedStylesDirectory } from "../support/visual/paths.ts";
import { SELECTORS, type SelectorSpec } from "../support/visual/selectors.ts";
import { fragment, fragmentFileName, type ElementStyles } from "../support/visual/snapshot.ts";

/**
 * MANDATORY computed-style snapshot (plan `docs/plans/2026-11-08-design-changeability.md`, section 7): for 8 pages in light
 * and dark at 1280, plus a 390 pass of the header, hero, banner and card selectors on home and catalog, the computed styles
 * of the fixed selector list (`support/visual/selectors.ts`) are written as one JSON fragment per page and theme into
 * `$VISUAL_COMPUTED_DIR`. A page that did not stay on its address or misses one of its required selectors
 * (`REQUIRED_SELECTORS`) fails: "absent on both sides" must never pass for "identical". This spec records only;
 * `support/visual/compare-cli.ts` compares two recordings (`scripts/visual-compare.sh`).
 */

const directory = computedStylesDirectory();

function record(
  target: VisualPage,
  theme: (typeof COMPUTED_STYLE_THEMES)[number],
  selectors: readonly SelectorSpec[],
): void {
  test(`computed styles: ${target.id} (${theme})`, async ({ page, context }) => {
    await setTheme(context, theme);
    await preparePage(page, target);
    const response = await page.goto(target.path);
    expect(response?.status(), `${target.path} must render`).toBeLessThan(400);
    await expect(page).toHaveURL(new URL(target.path, E2E_ORIGIN).href);
    await settle(page);
    const styles: Record<string, ElementStyles> = {};
    for (const spec of selectors) styles[spec.name] = await computedStylesOf(page, spec);
    expect(
      missingRequiredSelectors(target.id, styles),
      `required selectors on ${target.path}`,
    ).toEqual([]);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, fragmentFileName(target.id, theme)),
      `${JSON.stringify(fragment(target.id, theme, target.path, styles), null, 2)}\n`,
    );
  });
}

test.describe("desktop", () => {
  test.use({ viewport: COMPUTED_STYLE_VIEWPORT, reducedMotion: "reduce" });
  for (const target of COMPUTED_STYLE_PAGES) {
    for (const theme of COMPUTED_STYLE_THEMES) record(target, theme, SELECTORS);
  }
});

test.describe("phone", () => {
  test.use({ viewport: COMPUTED_STYLE_MOBILE_VIEWPORT, reducedMotion: "reduce" });
  const subset = SELECTORS.filter((spec) => COMPUTED_STYLE_MOBILE_SELECTORS.includes(spec.name));
  for (const target of COMPUTED_STYLE_MOBILE_PAGES) {
    for (const theme of COMPUTED_STYLE_THEMES) record(target, theme, subset);
  }
});
