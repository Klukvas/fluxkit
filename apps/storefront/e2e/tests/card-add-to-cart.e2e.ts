import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

// Add to cart from a product card (owner design 2026-11-13): a product with one sellable variant (`defaultVariantId` of the
// list item) is added from its card, and the header's cart badge counts it; a product with several variants links to its
// page to choose; an out-of-stock one offers nothing. Works with search on and off (the category page falls back to the
// SQL listing, which carries the same field).

const products = (page: Page, name = "Products") => page.getByRole("list", { name });

test("adds a one-variant product from its catalog card and the cart badge counts it", async ({
  page,
}) => {
  await page.goto("/en/c/demo-tools");
  await waitForHydration(page);
  await expect(page.getByRole("link", { name: /Cart.*0 items in the cart/ })).toBeVisible();

  const card = products(page)
    .getByRole("article")
    .filter({ has: page.getByRole("link", { name: "Demo Screwdriver", exact: true }) });
  const add = card.getByRole("button", { name: "Add to cart Demo Screwdriver" });
  await expect(add).toBeVisible();
  // A touch-size target, outside the product link (the click must not navigate).
  expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await add.click();

  // The button confirms in its own words for a moment and the status region announces it.
  await expect(card.getByRole("button", { name: "Added Demo Screwdriver" })).toBeVisible();
  await expect(card.getByRole("status")).toHaveText("Added to the cart.");
  await expect(page).toHaveURL(/\/en\/c\/demo-tools$/);
  await expect(page.getByRole("link", { name: /Cart.*1 item in the cart/ })).toBeVisible();
  // Then it offers to add again (CARD_ADDED_MS, 2.5 s; the cart badge keeps the count).
  await expect(card.getByRole("button", { name: "Add to cart Demo Screwdriver" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Added Demo Screwdriver" })).toHaveCount(0);

  // The line is in the cart, at the server's price (the card sent only the variant and the quantity).
  await page.goto("/en/cart");
  await expect(
    page.getByRole("list", { name: "Items in the cart" }).getByText("Demo Screwdriver"),
  ).toBeVisible();

  // Out of stock: no button and no link besides the product's own.
  await page.goto("/en/c/demo-tools");
  const wrench = products(page)
    .getByRole("article")
    .filter({ has: page.getByRole("link", { name: "Demo Adjustable Wrench", exact: true }) });
  await expect(wrench.getByText("Out of stock")).toBeVisible();
  await expect(wrench.getByRole("button")).toHaveCount(0);
  await expect(wrench.getByRole("link", { name: /Choose options/ })).toHaveCount(0);
});

test("a product with several variants links from its card to the product page to choose", async ({
  page,
}) => {
  // A plain link: it works before (and without) the page's scripts, so no wait for hydration.
  await page.goto("/uk/c/demo-clothing-shirts");
  const choose = products(page, "Товари").getByRole("link", {
    name: "Обрати варіант Демо лляна сорочка",
  });
  await expect(choose).toBeVisible();
  expect((await choose.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const href = await choose.getAttribute("href");
  expect(href).toBe("/uk/p/demo-linen-shirt");
  await choose.click();
  await expect(page).toHaveURL(/\/uk\/p\/demo-linen-shirt$/);
  await expect(page.getByRole("heading", { level: 1, name: "Демо лляна сорочка" })).toBeVisible();
});

test("without a script the add control is a working link to the product page, never a dead disabled button", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/en/c/demo-tools");
    const card = products(page)
      .getByRole("article")
      .filter({ has: page.getByRole("link", { name: "Demo Screwdriver", exact: true }) });
    // One control: the link in the button's place, with its words and its 44 px.
    await expect(card.getByRole("button")).toHaveCount(0);
    const fallback = card.getByRole("link", { name: "Add to cart Demo Screwdriver" });
    await expect(fallback).toHaveAttribute("href", "/en/p/demo-screwdriver");
    expect((await fallback.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await fallback.click();
    await expect(page).toHaveURL(/\/en\/p\/demo-screwdriver$/);
  } finally {
    await context.close();
  }
});

for (const width of [320, 390]) {
  test(`the card actions fit a ${width} px grid card in Ukrainian and keep the prices of a row on one line`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/uk/catalog");
    const actions = products(page, "Товари").locator("article :is(a, button)[class*='min-h-11']");
    await expect(actions.first()).toBeVisible();
    const boxes = await actions.evaluateAll((elements) =>
      elements.map((element) => ({
        overflow: element.scrollWidth - element.clientWidth,
        height: element.getBoundingClientRect().height,
      })),
    );
    for (const box of boxes) {
      expect(box.overflow).toBeLessThanOrEqual(0);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // Per row of cards (same top), the prices end on one line whatever the action's label wraps to.
    const rows = await products(page, "Товари")
      .getByRole("article")
      .evaluateAll((articles) =>
        articles.map((article) => {
          const price = [...article.querySelectorAll("span")].find(
            (span) => /₴/.test(span.textContent ?? "") && span.childElementCount === 0,
          );
          return {
            top: Math.round(article.getBoundingClientRect().top),
            priceBottom: Math.round(price?.getBoundingClientRect().bottom ?? -1),
          };
        }),
      );
    const byRow = new Map<number, Set<number>>();
    for (const { top, priceBottom } of rows) {
      byRow.set(top, (byRow.get(top) ?? new Set<number>()).add(priceBottom));
    }
    for (const [top, bottoms] of byRow) {
      expect(bottoms.size, `row at ${top}: price bottoms ${[...bottoms].join(", ")}`).toBe(1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}
