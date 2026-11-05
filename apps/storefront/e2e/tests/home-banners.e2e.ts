import type { Page } from "@playwright/test";
import { E2E_ORIGIN } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { tabTo } from "../support/flows.ts";

/**
 * Promotional banners on the home page (plan `docs/plans/2026-11-05-home-banners.md`): the `banners` section of
 * `config/home.ts` between the hero and the category tiles. Each card is one link named by its title; pictures keep their
 * size (no shift) and load lazily below the hero; one column on phones, one row from 768 px. The dark contrast walk of the
 * home page is in `design-b.e2e.ts`.
 */

const DESKTOP = { width: 1280, height: 800 };
test.use({ viewport: DESKTOP });

const banners = (page: Page) => page.getByRole("main").locator('[data-home-section="banners"]');

const DEMO = [
  {
    name: "New this season",
    description: "Fresh picks from the catalog, in one place.",
    href: "/en/catalog",
  },
  {
    name: "Gift ideas",
    description: "Browse the catalog by category to find a gift.",
    href: "/en/catalog",
  },
  {
    name: "Create an account",
    description: "See all your orders and their status in one place.",
    href: "/en/account/register",
  },
];

test("the banners sit between the hero and the categories, each card one named link with a sized, lazy picture", async ({
  page,
}) => {
  await page.goto("/en");
  const section = banners(page);
  await expect(section).toBeVisible();
  await expect(page.getByRole("region", { name: "Offers" })).toBeVisible();
  const order = await page
    .locator("main [data-hero], main [data-home-section]")
    .evaluateAll((elements) =>
      elements.map((element) =>
        element.hasAttribute("data-hero") ? "hero" : element.getAttribute("data-home-section"),
      ),
    );
  expect(order.slice(0, 3)).toEqual(["hero", "banners", "categories"]);

  const links = section.getByRole("link");
  await expect(links).toHaveCount(3);
  for (const [index, banner] of DEMO.entries()) {
    const link = section.getByRole("link", { name: banner.name, exact: true });
    await expect(link).toHaveAttribute("href", banner.href);
    await expect(link).toHaveAccessibleDescription(banner.description);
    await expect(link.getByRole("heading", { level: 3, name: banner.name })).toBeVisible();
    const picture = link.locator("img");
    await expect(picture).toHaveAttribute("src", `/home/banner-${String(index + 1)}.svg`);
    await expect(picture).toHaveAttribute("width", "640");
    await expect(picture).toHaveAttribute("height", "320");
    await expect(picture).toHaveAttribute("loading", "lazy");
    expect(await picture.getAttribute("alt")).not.toBe("");
  }

  // The whole card is the target: its picture opens the link too.
  await section.getByRole("link", { name: "Gift ideas" }).locator("img").click();
  await expect(page).toHaveURL(`${E2E_ORIGIN}/en/catalog`);
});

// Not tested without a script: the home page is outlined by React's streaming (its content needs the script; storefront
// README, "Keep the header small"), before and after this change.
test("a banner opens by keyboard, with a visible focus ring", async ({ page }) => {
  await page.goto("/uk");
  const account = banners(page).getByRole("link", { name: "Створіть обліковий запис" });
  await tabTo(page, account, 60);
  await expect(account).toBeFocused();
  const outline = await account.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${E2E_ORIGIN}/uk/account/register`);
});

for (const width of [390, 768, 1024, 1280]) {
  test(`the banners fit ${String(width)} px without sideways scrolling: ${width < 768 ? "one column" : "one row"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/uk");
    const cards = banners(page).locator("li");
    await expect(cards).toHaveCount(3);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const boxes = await cards.evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().toJSON() as DOMRect),
    );
    const [first, second, third] = boxes as [DOMRect, DOMRect, DOMRect];
    if (width < 768) {
      expect(second.x).toBeCloseTo(first.x, 0);
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
      expect(third.y).toBeGreaterThanOrEqual(second.y + second.height);
    } else {
      expect(second.y).toBeCloseTo(first.y, 0);
      expect(third.y).toBeCloseTo(first.y, 0);
      expect(second.x).toBeGreaterThan(first.x + first.width - 1);
    }
    // Every picture keeps its 2:1 box (the reserved size), so nothing moves when it loads.
    for (const picture of await banners(page).locator("img").all()) {
      await picture.scrollIntoViewIfNeeded();
      const box = await picture.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(2, 1);
    }
  });
}
