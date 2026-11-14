import type { Cart } from "@fluxkit/api-client";
import { expect, test } from "../support/fixtures.ts";
import { formatMoney } from "../../src/lib/money.ts";
import { waitForHydration } from "../support/flows.ts";

test("card add opens the cart, saves quantity and continues to checkout", async ({ page }) => {
  await page.goto("/en/c/demo-tools");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Add to cart Demo Screwdriver" }).click();
  const drawer = page.getByRole("dialog", { name: /^Cart/ });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Demo Screwdriver", exact: true })).toBeVisible();
  // Observe the server's cart answer: display totals must equal the returned money, not a client-side draft.
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/store/cart/items/") && response.request().method() === "PATCH",
  );
  await drawer.getByRole("button", { name: "Increase quantity of Demo Screwdriver" }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const cart = (await response.json()) as {
    lines: { lineTotal: { amount: number; currency: string } | null }[];
    subtotal: { amount: number; currency: string };
  };
  const lineTotal = cart.lines[0]?.lineTotal;
  expect(lineTotal).not.toBeNull();
  if (lineTotal === null || lineTotal === undefined)
    throw new Error("Cart response has no line total");
  // Demo UAH (two fraction digits), both amounts are read directly from the server reply.
  await expect(
    drawer
      .getByRole("list", { name: "Items in the cart" })
      .getByText(formatMoney(lineTotal, 2, "en"), { exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByText(formatMoney(cart.subtotal, 2, "en"), { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const cartLink = page
    .getByRole("banner")
    .getByRole("link", { name: /Cart.*2 items in the cart/ });
  await expect(cartLink).toBeVisible();
  await cartLink.click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Checkout", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/checkout$/);
});

test("Escape returns focus to the header link and the product submitter", async ({ page }) => {
  await page.goto("/en/p/demo-screwdriver");
  await waitForHydration(page);
  const header = page.getByRole("banner").getByRole("link", { name: /Cart/ });
  await header.click();
  await expect(page.getByRole("dialog", { name: /^Cart/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(header).toBeFocused();
  const add = page.getByRole("button", { name: "Add to cart", exact: true });
  await add.click();
  await expect(page.getByRole("dialog", { name: /^Cart/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
});

test("the empty drawer links to the catalog and its real backdrop button closes it", async ({
  page,
}) => {
  await page.goto("/en/catalog");
  await waitForHydration(page);
  await page.getByRole("banner").getByRole("link", { name: /Cart/ }).click();
  const drawer = page.getByRole("dialog", { name: /^Cart/ });
  await expect(drawer.getByText("Your cart is empty", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Browse the catalog" })).toHaveAttribute(
    "href",
    "/en/catalog",
  );
  await drawer
    .getByRole("button", { name: "Close the cart" })
    .first()
    .click({ position: { x: 10, y: 10 } });
  await expect(drawer).toHaveCount(0);
});

test.describe("free-shipping progress", () => {
  test.afterEach(async ({ admin }) => {
    await admin.deactivateShippingMethods();
  });

  test("drawer shows the server remainder and unlocks free delivery at the threshold", async ({
    page,
    admin,
    shopper,
  }, testInfo) => {
    const product = await shopper.product("demo-screwdriver");
    const variant = product.variants[0];
    if (variant === undefined) throw new Error("Seed screwdriver has no variant");
    await admin.createShippingMethod({
      code: `drawer_free_${String(testInfo.retry)}`,
      title: "Free-over courier",
      kind: "address",
      pricing: { type: "free_over", amount: 9000, freeFrom: variant.price.amount * 2 },
    });
    await page.goto("/en/c/demo-tools");
    await waitForHydration(page);
    const added = page.waitForResponse(
      (response) =>
        response.url().endsWith("/store/cart/items") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Add to cart Demo Screwdriver" }).click();
    const response = await added;
    expect(response.ok()).toBe(true);
    const cart = (await response.json()) as Cart;
    const freeShipping = cart.freeShipping;
    expect(freeShipping).not.toBeNull();
    if (freeShipping === null) throw new Error("Cart response has no free-shipping progress");
    const drawer = page.getByRole("dialog", { name: /^Cart/ });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("progressbar")).toBeVisible();
    await expect(drawer.getByRole("progressbar")).toHaveAttribute(
      "value",
      String(cart.subtotal.amount),
    );
    await expect(drawer.getByRole("progressbar")).toHaveAttribute(
      "max",
      String(freeShipping.threshold.amount),
    );
    await expect(
      drawer.getByText(`${formatMoney(freeShipping.remaining, 2, "en")} more for free delivery`, {
        exact: true,
      }),
    ).toBeVisible();
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/store/cart/items/") && response.request().method() === "PATCH",
    );
    await drawer.getByRole("button", { name: "Increase quantity of Demo Screwdriver" }).click();
    const updatedResponse = await saved;
    expect(updatedResponse.ok()).toBe(true);
    const updated = (await updatedResponse.json()) as Cart;
    expect(updated.freeShipping?.remaining.amount).toBe(0);
    await expect(drawer.getByText("Free delivery unlocked", { exact: true })).toBeVisible();
  });
});
