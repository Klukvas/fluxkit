import type { Locator } from "@playwright/test";
import { E2E_SEARCH_ENABLED } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

/**
 * ADR 0048: text typed into the header search box BEFORE the page's scripts run must survive hydration, on the home page
 * (under its loading view) and on a page rendered inside the shell (the sign-in page). Design batch B found 5 losses in 40
 * runs when the home page left `(site)` (README, "Keep the header small"); this makes it deterministic: the scripts are held
 * until the text is typed, then released.
 */
test.skip(!E2E_SEARCH_ENABLED, "needs the API with search on (the header box)");
test.use({ viewport: { width: 1280, height: 800 } });

/** How many times each page runs; the spike measured 40 in CI (ADR 0048), the suite keeps one. */
const RUNS = 40; // SCRATCH spike L1

const isHydrated = (element: Locator) =>
  element.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps")));

for (const path of ["/uk", "/uk/account/login"]) {
  for (let run = 1; run <= RUNS; run += 1) {
    test(`${path}: text typed before hydration stays and suggests (run ${String(run)})`, async ({
      page,
    }) => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Scripts only: a held stylesheet would block the first paint, and the point is a page on screen but not alive.
      await page.route("**/_next/static/chunks/**", async (route) => {
        if (route.request().resourceType() === "script") await gate;
        await route.continue();
      });
      const started = Date.now();
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const box = page.getByRole("combobox", { name: "Пошук товарів" });
      await box.click();
      await box.pressSequentially("викрут", { delay: 30 });
      expect(await isHydrated(box), "the box hydrated while its scripts were held").toBe(false);
      // What is still out of place while the shopper types (a segment not yet swapped in, a pending boundary).
      const pending = await page.evaluate(() => ({
        segments: [...document.querySelectorAll('div[hidden][id^="S:"]')].map((node) =>
          node.innerHTML.slice(0, 80),
        ),
        boundaries: document.querySelectorAll('template[id^="B:"]').length,
        boxInHeader: document.querySelector('header input[role="combobox"]') !== null,
      }));
      console.log(`SEARCH-PENDING ${JSON.stringify({ path, run, ...pending })}`);
      const held = 1500 - (Date.now() - started);
      if (held > 0) await page.waitForTimeout(held);
      release();

      await expect.poll(() => isHydrated(box)).toBe(true);
      await expect(box, "the text typed before hydration").toHaveValue("викрут");
      // The state behind the box has the text too: one more letter asks for suggestions of the whole word.
      await box.press("End");
      await box.pressSequentially("к", { delay: 30 });
      await expect(box).toHaveValue("викрутк");
      await expect(page.getByRole("option", { name: "Демо викрутка" })).toBeVisible();
    });
  }
}
