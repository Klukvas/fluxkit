import type { Page } from "@playwright/test";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import {
  chooseOptions,
  fillCheckoutForm,
  openLanguageMenu,
  waitForHydration,
} from "../support/flows.ts";

/**
 * The UX review fixes, batch A (plan `docs/plans/2026-11-02-storefront-ux-review-a.md`): one price text on the server and
 * in the browser (no hydration error), honest filtered cards, the cart's quantity and stock named before checkout, bad
 * query parameters that redirect instead of "page not found", a language switch that keeps the checkout form, the variant
 * and the search words, and the registration form's own checks.
 */

/** Console errors and uncaught page errors, for "no hydration error" (React reports a mismatch as an error). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const HYDRATION = /hydrat|#418|#423|#425/i;

test("prices render the same on the server and in the browser: no hydration error on catalog, product, cart and checkout (SQ-06)", async ({
  page,
  shopper,
}) => {
  const errors = collectErrors(page);
  const black = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-BLACK-M");
  await shopper.addToCart(black.id, 1);

  // The server's HTML and the hydrated page show the same hryvnia text.
  const html = await (await page.request.get("/uk/p/demo-t-shirt")).text();
  expect(html).toContain("599,00 ₴");
  for (const path of ["/uk/catalog", "/uk/p/demo-t-shirt", "/uk/cart", "/uk/checkout"]) {
    await page.goto(path);
    // Hydrated and the cart read: a mismatch would have re-rendered the price by now.
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/599,00\s₴/).first()).toBeVisible();
    await expect(page.getByText(/грн/)).toHaveCount(0);
  }
  for (const path of ["/en/catalog", "/en/p/demo-t-shirt", "/en/cart", "/en/checkout"]) {
    await page.goto(path);
    await expect(page.getByText(/UAH\s599\.00/).first()).toBeVisible();
  }
  expect(errors.filter((line) => HYDRATION.test(line))).toEqual([]);
});

test("a card under option filters does not claim the product's stock and opens the matching variant (SQ-03)", async ({
  page,
}) => {
  await page.goto("/en/catalog?f=opt.color%3Ared&f=opt.size%3Al");
  const card = page.getByRole("article").filter({ hasText: "Demo T-shirt" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Price and stock depend on the option")).toBeVisible();
  await expect(card.getByText("In stock", { exact: true })).toHaveCount(0);
  const link = card.getByRole("link", { name: "Demo T-shirt" });
  await expect(link).toHaveAttribute("href", "/en/p/demo-t-shirt?opt.color=red&opt.size=l");

  // inStock:false alone: every matching variant is out of stock, and the card says so.
  await page.goto("/en/catalog?f=inStock%3Afalse");
  const outCard = page.getByRole("article").filter({ hasText: "Demo T-shirt" });
  await expect(outCard.getByText("Out of stock", { exact: true })).toBeVisible();

  await page.goto("/en/p/demo-t-shirt?opt.color=red&opt.size=l");
  await expect(
    page.getByRole("group", { name: "Color", exact: true }).getByRole("radio", { name: "Red" }),
  ).toBeChecked();
  await expect(
    page.getByRole("group", { name: "Size", exact: true }).getByRole("radio", { name: "L" }),
  ).toBeChecked();
  await expect(page.locator("#product-availability")).toHaveText("Out of stock");
});

test("the product page names the cart's quantity, caps the stepper and explains the limit (SQ-02)", async ({
  page,
  shopper,
}) => {
  const red = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-RED-M");
  await shopper.addToCart(red.id, 999);
  await page.goto("/en/p/demo-t-shirt?opt.color=red&opt.size=m");
  await waitForHydration(page);
  await expect(
    page.getByText(
      "You already have 999 of this item in your cart, the most one item allows (999).",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeDisabled();

  // The checkout names the problem lines as soon as it loads (the API gives no stock number; this line is not low stock,
  // so only the refusal at submit can tell; an out-of-stock line is named at once).
  const gone = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-RED-L");
  await shopper.addToCart(gone.id, 1);
  await page.goto("/en/checkout");
  await expect(page.getByText(/^Out of stock: Demo T-shirt \(Red, L\)\./)).toBeVisible();
});

test("bad query parameters redirect to the cleaned address instead of 'page not found' (SQ-04)", async ({
  page,
}) => {
  for (const [path, target] of [
    ["/uk/catalog?sort=zzz", /\/uk\/catalog$/],
    ["/uk/catalog?page=-1", /\/uk\/catalog$/],
    ["/uk/catalog?page=abc", /\/uk\/catalog$/],
    ["/uk/catalog?page=999", /\/uk\/catalog$/],
    ["/uk/catalog?f=garbage", /\/uk\/catalog$/],
    ["/uk/c/demo-tools?page=abc", /\/uk\/c\/demo-tools$/],
    ["/uk/search?q=%00x", /\/uk\/search\?q=x$/],
    [`/uk/search?q=${"a".repeat(600)}`, new RegExp(`/uk/search\\?q=${"a".repeat(200)}$`)],
    ["/uk/search?q=demo&page=999", /\/uk\/search\?q=demo$/],
  ] as const) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page, path).toHaveURL(target);
    await expect(page.getByRole("heading", { level: 1, name: "Сторінку не знайдено" })).toHaveCount(
      0,
    );
  }
  // A real unknown slug stays a real 404.
  expect((await page.goto("/uk/c/no-such-category"))?.status()).toBe(404);
});

test("switching the language keeps the checkout form, the product's variant and the search words (SQ-05)", async ({
  page,
  shopper,
}, testInfo) => {
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  await page.goto("/uk/checkout");
  await page.waitForLoadState("networkidle");
  const email = uniqueEmail(testInfo, "draft");
  await page.getByLabel("Електронна пошта", { exact: true }).fill(email);
  const phoneField = page.getByLabel("Телефон", { exact: true });
  await phoneField.fill("0501234567");
  const phone = await phoneField.inputValue();
  expect(phone).not.toBe("");
  await page.getByLabel("Місто", { exact: true }).fill("Київ");
  await page.getByLabel("Вулиця і номер будинку", { exact: true }).fill("Хрещатик, 1");
  await openLanguageMenu(page);
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/checkout$/);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("Phone", { exact: true })).toHaveValue(phone);
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("Київ");
  await expect(page.getByLabel("Street and house number", { exact: true })).toHaveValue(
    "Хрещатик, 1",
  );

  await page.goto("/uk/p/demo-t-shirt");
  await chooseOptions(page, { Колір: "Червоний", Розмір: "M" });
  await expect(page).toHaveURL(/\/uk\/p\/demo-t-shirt\?opt\.color=red&opt\.size=m$/);
  await openLanguageMenu(page);
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/p\/demo-t-shirt\?opt\.color=red&opt\.size=m$/);
  await expect(
    page.getByRole("group", { name: "Color", exact: true }).getByRole("radio", { name: "Red" }),
  ).toBeChecked();

  await page.goto("/uk/search?q=%D0%BC%D0%BE%D0%BB%D0%BE%D1%82%D0%BE%D0%BA");
  await openLanguageMenu(page);
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/search\?q=%D0%BC%D0%BE%D0%BB%D0%BE%D1%82%D0%BE%D0%BA$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Results for “молоток”" }),
  ).toBeVisible();
});

test("the checkout draft is gone once the order is placed (SQ-05)", async ({
  page,
  shopper,
}, testInfo) => {
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  await page.goto("/en/checkout");
  await waitForHydration(page);
  await fillCheckoutForm(page, { email: uniqueEmail(testInfo, "draft-done") });
  expect(
    await page.evaluate(() => window.sessionStorage.getItem("fluxkit.checkoutDraft")),
  ).not.toBeNull();
  await page.getByRole("button", { name: "Place the order" }).click();
  await expect(page).toHaveURL(/\/en\/order\//);
  expect(
    await page.evaluate(() => window.sessionStorage.getItem("fluxkit.checkoutDraft")),
  ).toBeNull();
});

test("registration flags a bad email and a short password in the first pass (D-06)", async ({
  page,
}) => {
  await page.goto("/en/account/register");
  await page.getByLabel("Email", { exact: true }).fill("bad");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText("Enter an email address like name@example.com.").first(),
  ).toBeVisible();
  await expect(page.getByText("The password needs at least 12 characters.").first()).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
});
