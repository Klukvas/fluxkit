import { E2E_ORIGIN } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { readLayoutShifts, watchLayoutShifts } from "../support/layout-shift.ts";

// Plan 2026-11-14-playful-default-design WS-D: optional ornaments, CSS motion and stable section geometry.
for (const locale of ["en", "uk"] as const) {
  for (const width of [1280, 360]) {
    test(`playful home ${locale} at ${width}px: ornaments, opaque LCP, reveals and CLS`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await context.addCookies([
        { name: "fluxkit_theme", value: width === 360 ? "dark" : "light", url: E2E_ORIGIN },
      ]);
      await watchLayoutShifts(page, "main [data-hero]");
      await page.goto(`/${locale}`);
      const hero = page.locator("main [data-hero]");
      await expect(hero.locator("[data-home-blob]")).toHaveAttribute("aria-hidden", "true");
      await expect(hero.locator("[data-home-sticker]")).toHaveAttribute("aria-hidden", "true");
      await expect(hero.locator("textPath")).toHaveText(
        locale === "en" ? "New arrivals • Fast delivery • " : "Новинки • Швидка доставка • ",
      );
      await expect(hero.locator("h1 [data-home-highlight]")).toHaveText(
        locale === "en" ? "Welcome" : "просимо",
      );
      await expect(hero.locator("img")).toHaveAttribute("fetchpriority", "high");
      expect(
        await hero.locator("img").evaluate((image) => {
          for (let node: Element | null = image; node !== null; node = node.parentElement) {
            if (Number(getComputedStyle(node).opacity) !== 1) return false;
          }
          return true;
        }),
      ).toBe(true);
      const animations = await hero.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .map((animation) => (animation as CSSAnimation).animationName),
      );
      expect(animations).toContain("fk-home-spin");
      expect(animations).toContain("fk-home-morph");
      await expect(page.locator('main [data-home-section="productRow"] article')).toHaveCount(8);
      await expect(page.locator("main [data-home-reveal]")).toHaveCount(5);
      await expect(
        page.locator('[data-home-reveal="pop-in"] [data-home-section="categories"]'),
      ).toBeAttached();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const stickerBox = await hero.locator("[data-home-sticker]").boundingBox();
      const heroBox = await hero.boundingBox();
      expect(stickerBox).not.toBeNull();
      expect(heroBox).not.toBeNull();
      if (stickerBox && heroBox) {
        expect(stickerBox.x).toBeGreaterThanOrEqual(heroBox.x);
        expect(stickerBox.x + stickerBox.width).toBeLessThanOrEqual(heroBox.x + heroBox.width);
      }
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(800);
      const shifts = await readLayoutShifts(page);
      expect(shifts.readyAt).not.toBeNull();
      expect(shifts.afterReady, shifts.sources.join(" | ")).toBeLessThan(0.05);
      expect(shifts.beforeReady).toBeLessThan(0.05);
    });
  }

  test(`playful home ${locale}: reduced motion keeps static ornaments and no hero animations`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${locale}`);
    const hero = page.locator("main [data-hero]");
    await expect(hero.locator("[data-home-sticker]")).toBeVisible();
    expect(await hero.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(
      0,
    );
    await expect(hero.locator("[data-home-highlight]")).toHaveCSS("background-size", "100% 24%");
    await expect(page.locator('main [data-home-section="productRow"] article')).toHaveCount(8);
    expect(
      await page
        .locator("main [data-home-reveal]")
        .evaluateAll((elements) =>
          elements.every((element) => element.getAnimations({ subtree: false }).length === 0),
        ),
    ).toBe(true);
  });
}
