import type { Page } from "@playwright/test";
import { E2E_SEARCH_ENABLED } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

/**
 * The storefront's use of the two API fields of PR 214 (plan `docs/plans/2026-11-03-storefront-use-match-and-stock-hints.md`):
 * a filtered card shows its matching variants' price, availability and link (`items[].match` of `GET /store/search`), and a
 * cart line the checkout would refuse for stock says so (`insufficientStock`, `maxQuantity`) on the cart, the product page
 * and the checkout, before the shopper fills in the form.
 *
 * Demo data (`seeds/README.md`): T-shirt red s 18, m 22, l 0 (629.00), black s 3 (599.00); hoodie black xl 5 (1 349.00,
 * low stock at the threshold), blue xl 9.
 */

const card = (page: Page, title: string) => page.getByRole("article").filter({ hasText: title });

test.describe("filtered cards from the matched variants", () => {
  test.skip(
    !E2E_SEARCH_ENABLED,
    "needs the API with search on (the catalog lists through the index)",
  );

  test("one option pair: the matched variant's price, availability and a link that preselects it", async ({
    page,
  }) => {
    await page.goto("/en/catalog?f=opt.color%3Ared&f=opt.size%3Al");
    const tShirt = card(page, "Demo T-shirt");
    await expect(tShirt.getByText(/UAH\s629\.00/)).toBeVisible();
    await expect(tShirt.getByText(/from/)).toHaveCount(0);
    await expect(tShirt.getByText("Out of stock", { exact: true })).toBeVisible();
    await expect(tShirt.getByText("Price and stock depend on the option")).toHaveCount(0);
    const link = tShirt.getByRole("link", { name: "Demo T-shirt", exact: true });
    await expect(link).toHaveAttribute("href", "/en/p/demo-t-shirt?opt.color=red&opt.size=l");
    await link.click();
    await expect(page).toHaveURL(/\/en\/p\/demo-t-shirt\?opt\.color=red&opt\.size=l$/);
    await expect(
      page.getByRole("group", { name: "Size", exact: true }).getByRole("radio", { name: "L" }),
    ).toBeChecked();
    await expect(page.locator("#product-availability")).toHaveText("Out of stock");
  });

  test("several matching options: how many, the best availability and the representative in the link", async ({
    page,
  }) => {
    await page.goto("/en/catalog?f=opt.color%3Ared");
    const tShirt = card(page, "Demo T-shirt");
    await expect(tShirt.getByText("3 matching options")).toBeVisible();
    await expect(tShirt.getByText(/UAH\s629\.00/)).toBeVisible();
    await expect(tShirt.getByText("In stock", { exact: true })).toBeVisible();
    // The best available, then the cheapest, then the first in the product's order: red S (18 in stock).
    await expect(tShirt.getByRole("link", { name: "Demo T-shirt", exact: true })).toHaveAttribute(
      "href",
      "/en/p/demo-t-shirt?opt.color=red&opt.size=s",
    );
  });

  test("the availability filter both ways: low stock is never 'In stock' (PR 213 review M1), out of stock says so", async ({
    page,
  }) => {
    // Hoodie black XL has 5 (the low-stock threshold): the product is in stock, the matched variant is not.
    await page.goto("/en/catalog?f=inStock%3Atrue&f=opt.color%3Ablack&f=opt.size%3Axl");
    const hoodie = card(page, "Demo Hoodie");
    await expect(hoodie.getByText("Only a few left", { exact: true })).toBeVisible();
    await expect(hoodie.getByText("In stock", { exact: true })).toHaveCount(0);
    await expect(hoodie.getByText(/UAH\s1,349\.00/)).toBeVisible();

    await page.goto("/en/catalog?f=inStock%3Afalse");
    const tShirt = card(page, "Demo T-shirt");
    await expect(tShirt.getByText("Out of stock", { exact: true })).toBeVisible();
    await expect(tShirt.getByRole("link", { name: "Demo T-shirt", exact: true })).toHaveAttribute(
      "href",
      "/en/p/demo-t-shirt?opt.color=red&opt.size=l",
    );
  });

  test("a price range: the matched variants' price, not the product's lowest; Ukrainian format", async ({
    page,
  }) => {
    await page.goto("/en/catalog?price=60000..70000");
    const tShirt = card(page, "Demo T-shirt");
    await expect(tShirt.getByText(/UAH\s629\.00/)).toBeVisible();
    await expect(tShirt.getByText(/599\.00/)).toHaveCount(0);

    await page.goto("/uk/catalog?f=opt.color%3Ared&f=opt.size%3Al");
    const uk = card(page, "Демо футболка");
    await expect(uk.getByText(/629,00\s₴/)).toBeVisible();
    await expect(uk.getByText("Немає в наявності", { exact: true })).toBeVisible();
  });
});

test("999 of a variant with 22: the cart says so, blocks its checkout link, and the checkout flags it before the form", async ({
  page,
  shopper,
}) => {
  const red = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-RED-M");
  await shopper.addToCart(red.id, 999);

  // The product page: adding more cannot help.
  await page.goto("/en/p/demo-t-shirt?opt.color=red&opt.size=m");
  await waitForHydration(page);
  await expect(
    page.getByText(
      "Your cart already has 999 of this item, more than the shop has in stock. Change the quantity in the cart.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeDisabled();

  await page.goto("/en/cart");
  const line = page.getByRole("list", { name: "Items in the cart" }).getByRole("listitem").first();
  await expect(line.getByText("Not enough stock", { exact: true })).toBeVisible();
  await expect(
    line.getByText("Not enough stock. Reduce the quantity or remove the item."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Checkout" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Checkout" })).toBeDisabled();
  await expect(
    page.getByText("Not enough stock for these items. Change them to continue:"),
  ).toBeVisible();
  const toLine = page.getByRole("link", { name: /^Demo T-shirt/ }).last();
  await expect(toLine).toHaveAttribute("href", /^#cart-line-/);

  // The checkout, opened directly: the warning comes BEFORE the form, with a link to the line in the cart.
  await page.goto("/en/checkout");
  // A warning is a polite status message (`Alert`), not an interruption.
  const warning = page.getByRole("status").filter({ hasText: "Not enough stock" });
  await expect(warning).toBeVisible();
  await expect(
    warning.getByText("Not enough stock. Reduce the quantity or remove the item."),
  ).toBeVisible();
  const above = await page.evaluate(() => {
    const alert = [...document.querySelectorAll("[role=status]")].find((node) =>
      node.textContent?.includes("Not enough stock"),
    );
    // The checkout form (the header's search box is a form too).
    const form = [...document.querySelectorAll("form")].find((node) =>
      node.textContent?.includes("Place the order"),
    );
    return (
      alert !== undefined &&
      form !== undefined &&
      Boolean(alert.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  });
  expect(above).toBe(true);
  await expect(page.getByRole("button", { name: "Place the order" })).toHaveAttribute(
    "aria-describedby",
    "checkout-stock-warning",
  );
  await warning.getByRole("link", { name: /^Demo T-shirt/ }).click();
  await expect(page).toHaveURL(/\/en\/cart#cart-line-/);
});

test("8 of a variant with 3: 'Only 3 available', the stepper caps at 3, and lowering it unblocks the checkout", async ({
  page,
  shopper,
}) => {
  const black = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-BLACK-S");
  await shopper.addToCart(black.id, 8);
  await page.goto("/en/cart");
  await waitForHydration(page);
  const line = page.getByRole("list", { name: "Items in the cart" }).getByRole("listitem").first();
  await expect(
    line.getByText("Only 3 available. Lower the quantity to 3 or remove the item."),
  ).toBeVisible();
  const quantity = page.getByRole("spinbutton", { name: "Quantity of Demo T-shirt" });
  // The + button stops at the hint; a typed number does not (review m1 of PR 215: the server answers it).
  await expect(quantity).toHaveAttribute("max", "999");
  await expect(
    page.getByRole("button", { name: "Increase quantity of Demo T-shirt" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Checkout" })).toBeDisabled();

  // One step down lands on the cap; the server's answer clears the hint (the server is the judge).
  await page.getByRole("button", { name: "Decrease quantity of Demo T-shirt" }).click();
  await expect(quantity).toHaveValue("3");
  await expect(line.getByText(/Only 3 available/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Checkout" })).toBeVisible();
  await expect(line.getByText("Only a few left", { exact: true })).toBeVisible();

  // A typed 5 is sent as typed (not clamped to the old hint) and the server's answer flags it again.
  await quantity.fill("5");
  await expect(
    line.getByText("Only 3 available. Lower the quantity to 3 or remove the item."),
  ).toBeVisible();
  await expect(quantity).toHaveValue("5");
});

test("Checkout pressed while a quantity saves that the server flags for stock: the focus lands on the reason (review m5)", async ({
  page,
  shopper,
}) => {
  const red = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-RED-S");
  await shopper.addToCart(red.id, 1);
  await page.goto("/en/cart");
  await waitForHydration(page);
  await page.getByRole("spinbutton", { name: "Quantity of Demo T-shirt" }).fill("50");
  // Pressed within the save delay: the link waits for the save, whose answer blocks the checkout.
  await page.getByRole("link", { name: /Checkout|Saving/ }).click();
  await expect(page).toHaveURL(/\/en\/cart$/);
  await expect(page.getByRole("button", { name: "Checkout" })).toBeDisabled();
  await expect(page.locator("#cart-checkout-reason")).toBeFocused();
});
