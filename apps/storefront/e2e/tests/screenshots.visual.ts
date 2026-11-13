import { existsSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { E2E_ORIGIN } from "../support/env.ts";
import { locate, preparePage, setTheme, settle } from "../support/visual/browser.ts";
import {
  comparesViewportOnly,
  parseExceptions,
  screenshotMasks,
  skipsElementShot,
  type VisualException,
} from "../support/visual/exceptions.ts";
import { expect, test } from "../support/visual/fixture.ts";
import {
  ELEMENT_SHOT_PAGE_ID,
  ELEMENT_SHOT_SELECTORS,
  VIEWPORTS,
  frameName,
  screenshotFrames,
  type ScreenshotFrame,
} from "../support/visual/pages.ts";
import { masksFile } from "../support/visual/paths.ts";
import { selectorByName } from "../support/visual/selectors.ts";

/**
 * SECONDARY screenshot comparison (plan `docs/plans/2026-11-08-design-changeability.md`, section 7). Run by
 * `scripts/visual-compare.sh`: first in the base tree with `--update-snapshots=all` (writes the baseline into
 * `$VISUAL_SNAPSHOT_DIR`), then in the PR tree against that baseline. Full-page shots of every frame of
 * `support/visual/pages.ts`, plus element shots on the home page. Masks: `property: "screenshot"` entries of the effective
 * exceptions, which the script writes next to the baseline so both sides mask the same elements.
 */

const exceptions: VisualException[] = existsSync(masksFile())
  ? parseExceptions(JSON.parse(readFileSync(masksFile(), "utf8")), masksFile())
  : [];

const maskNamesFor = (frame: ScreenshotFrame) =>
  screenshotMasks(exceptions, frame.page.id, frame.theme);

const masksFor = (page: Page, frame: ScreenshotFrame) =>
  maskNamesFor(frame).map((name) => locate(page, selectorByName(name)));

async function open(page: Page, frame: ScreenshotFrame): Promise<void> {
  await setTheme(page.context(), frame.theme);
  if (frame.theme === "system") await page.emulateMedia({ colorScheme: "dark" });
  await preparePage(page, frame.page, frame.javaScript);
  await page.goto(frame.page.path);
  await expect(page).toHaveURL(new URL(frame.page.path, E2E_ORIGIN).href);
  await settle(page, frame.javaScript);
}

for (const frame of screenshotFrames()) {
  const name = frameName(frame);
  test.describe(name, () => {
    test.use({
      viewport: VIEWPORTS[frame.viewport],
      reducedMotion: "reduce",
      javaScriptEnabled: frame.javaScript,
    });

    test(`screenshot ${name}`, async ({ page }) => {
      await open(page, frame);
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: !comparesViewportOnly(maskNamesFor(frame)),
        mask: masksFor(page, frame),
      });
    });

    if (frame.page.id === ELEMENT_SHOT_PAGE_ID && frame.javaScript && frame.theme !== "system") {
      test(`element shots ${name}`, async ({ page }) => {
        await open(page, frame);
        for (const selector of ELEMENT_SHOT_SELECTORS) {
          const element = locate(page, selectorByName(selector));
          await expect(element, `${selector} must exist on ${frame.page.path}`).toHaveCount(1);
          if (skipsElementShot(maskNamesFor(frame), selector)) continue;
          await expect(element).toHaveScreenshot(`${name}--${selector}.png`, {
            mask: masksFor(page, frame),
          });
        }
      });
    }
  });
}
