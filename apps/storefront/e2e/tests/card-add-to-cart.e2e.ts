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

  await expect(card.getByRole("status")).toHaveText("Added to the cart.");
  await expect(page).toHaveURL(/\/en\/c\/demo-tools$/);
  await expect(page.getByRole("link", { name: /Cart.*1 item in the cart/ })).toBeVisible();
  // The confirmation goes away and the button offers to add again.
  await expect(card.getByRole("button", { name: "Add to cart Demo Screwdriver" })).toBeVisible();

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
  const choose = products(page, "Товари").getByRole("link", { name: "Обрати Демо лляна сорочка" });
  await expect(choose).toBeVisible();
  expect((await choose.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const href = await choose.getAttribute("href");
  expect(href).toBe("/uk/p/demo-linen-shirt");
  await choose.click();
  await expect(page).toHaveURL(/\/uk\/p\/demo-linen-shirt$/);
  await expect(page.getByRole("heading", { level: 1, name: "Демо лляна сорочка" })).toBeVisible();
});
