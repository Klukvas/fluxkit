import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computedStylesOf, preparePage, setTheme, settle } from "../support/visual/browser.ts";
import { expect, test } from "../support/visual/fixture.ts";
import {
  COMPUTED_STYLE_PAGES,
  COMPUTED_STYLE_THEMES,
  COMPUTED_STYLE_VIEWPORT,
} from "../support/visual/pages.ts";
import { SELECTORS } from "../support/visual/selectors.ts";
import { fragment, fragmentFileName, type ElementStyles } from "../support/visual/snapshot.ts";
import { computedStylesDirectory } from "../support/visual/paths.ts";

/**
 * MANDATORY computed-style snapshot (plan `docs/plans/2026-11-08-design-changeability.md`, section 7): for 8 pages in light
 * and dark, the computed styles of the fixed selector list (`support/visual/selectors.ts`) are written as one JSON fragment
 * per page and theme into `$VISUAL_COMPUTED_DIR`. This spec records only; `support/visual/compare-cli.ts` compares two
 * recordings (`scripts/visual-compare.sh` makes them: base and pull request, same machine, same run).
 */

test.use({ viewport: COMPUTED_STYLE_VIEWPORT, reducedMotion: "reduce" });

const directory = computedStylesDirectory();

for (const target of COMPUTED_STYLE_PAGES) {
  for (const theme of COMPUTED_STYLE_THEMES) {
    test(`computed styles: ${target.id} (${theme})`, async ({ page, context }) => {
      await setTheme(context, theme);
      await preparePage(page, target);
      const response = await page.goto(target.path);
      expect(response?.status(), `${target.path} must render`).toBeLessThan(400);
      await settle(page);
      const styles: Record<string, ElementStyles> = {};
      for (const spec of SELECTORS) styles[spec.name] = await computedStylesOf(page, spec);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, fragmentFileName(target.id, theme)),
        `${JSON.stringify(fragment(target.id, theme, target.path, styles), null, 2)}\n`,
      );
    });
  }
}
