import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";

/**
 * The mobile batch of the UX review (plan `docs/plans/2026-11-03-storefront-mobile-ux.md`), on a 390 x 844 touch screen
 * unless a test says otherwise: a sticky one-row header, the product page's buy bar and "added" toast, the filter sheet, the
 * cart's and the checkout's sticky bottom bars, the checkout summary above the form, the order page's heading and link
 * callout, tap-target sizes, no horizontal scroll, and no hydration error on any of these pages.
 */

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
test.use(PHONE);

const HYDRATION = /hydrat|#418|#423|#425/i;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("the element has no box (not rendered)");
  return found;
}

/** Waits until the header's cart badge read the cart (the islands are hydrated). */
async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole("banner").getByRole("link", { name: /Cart|Кошик/ })).toContainText(
    /in the cart|у кошику/,
  );
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("the header is one sticky row; the search opens behind its icon and Escape closes it (D-04)", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/uk/catalog");
  await hydrated(page);
  const header = page.getByRole("banner");
  expect((await box(header)).height).toBeLessThanOrEqual(64);
  await expect(page.getByRole("combobox", { name: "Пошук товарів" })).toBeHidden();

  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  // Still at the top of the screen, with the cart in reach.
  expect((await box(header)).y).toBe(0);
  await expect(header.getByRole("link", { name: /Кошик/ })).toBeInViewport();

  const toggle = header.getByRole("link", { name: "Пошук", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const searchBox = page.getByRole("combobox", { name: "Пошук товарів" });
  await expect(searchBox).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(searchBox).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(errors.filter((line) => HYDRATION.test(line))).toEqual([]);
});

test("without a script the search icon shows the search row (:target), and the box searches on every page, streamed ones too (review M2 of PR 216)", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...PHONE, javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  // The catalog, product and results pages stream the header's box: without a script the fallback form must be there.
  for (const path of ["/en", "/en/catalog", "/en/p/demo-hoodie", "/en/search?q=demo"]) {
    await page.goto(path);
    await page.getByRole("banner").getByRole("link", { name: "Search", exact: true }).click();
    await page.getByRole("combobox", { name: "Search products" }).fill("screwdriver");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page, path).toHaveURL(/\/en\/search\?q=screwdriver$/);
  }
  await context.close();
});

test("the 'added' toast steps aside while the search row is open (review m1 of PR 216)", async ({
  page,
}) => {
  await page.goto("/en/p/demo-hoodie");
  await hydrated(page);
  await page.getByTestId("buy-bar").getByText("Add to cart", { exact: true }).click();
  await expect(page.getByText("Added to the cart.")).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "Search", exact: true }).click();
  const searchBox = page.getByRole("combobox", { name: "Search products" });
  // Well inside the toast's own 8 s on screen: it must step aside at once, not time out.
  await expect(searchBox).toBeFocused({ timeout: 2000 });
  await expect(page.getByText("Added to the cart.")).toBeHidden({ timeout: 2000 });
  const hit = await searchBox.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element;
  });
  expect(hit).toBe(true);
});

test("the product page's buy bar shows while the add button is out of view, adds, and a toast links to the cart (D-02)", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/en/p/demo-hoodie");
  await hydrated(page);
  const bar = page.getByTestId("buy-bar");
  const inline = page.getByRole("button", { name: "Add to cart", exact: true });
  // One add button for assistive technology: the bar is a pointer shortcut.
  await expect(inline).toHaveCount(1);
  await expect(bar).toHaveAttribute("aria-hidden", "true");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Black · S");
  const barAdd = bar.getByText("Add to cart", { exact: true });
  expect((await box(barAdd)).height).toBeGreaterThanOrEqual(44);
  expect((await box(barAdd)).width).toBeGreaterThan(300);

  await barAdd.click();
  // The toast is fixed on a phone; its status region (the live region) holds it.
  const toast = page.getByRole("status").filter({ hasText: "Added to the cart." });
  await expect(toast.getByText("Added to the cart.")).toBeVisible();
  await expect(toast.getByRole("link", { name: "Go to the cart" })).toBeInViewport();
  await expect(
    page.getByRole("banner").getByRole("link", { name: /1 item in the cart/ }),
  ).toBeVisible();
  await toast.getByRole("button", { name: "Close the message" }).click();
  await expect(page.getByText("Added to the cart.")).toBeHidden();

  // The inline button in view: the bar goes away; it is full width and 48 px on a phone.
  await inline.scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
  expect((await box(inline)).height).toBeGreaterThanOrEqual(48);
  expect((await box(inline)).width).toBeGreaterThan(300);
  // Keyboard: the button keeps the focus while it adds (review A1).
  await inline.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("banner").getByRole("link", { name: /2 items in the cart/ }),
  ).toBeVisible();
  await expect(inline).toBeFocused();
  // The footer in view: no bar over it.
  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
  expect(errors.filter((line) => HYDRATION.test(line))).toEqual([]);
});

test("the filters open as a sheet: focus inside, Tab kept in, Escape returns, Apply filters; full-row checkboxes (D-05, A-02)", async ({
  page,
}) => {
  await page.goto("/en/catalog");
  await hydrated(page);
  const filters = page.getByRole("link", { name: "Filters", exact: true });
  // Next to the sort.
  const sort = page.getByRole("combobox", { name: "Sort by" });
  expect(
    Math.abs(
      (await box(filters)).y +
        (await box(filters)).height -
        ((await box(sort)).y + (await box(sort)).height),
    ),
  ).toBeLessThan(4);

  await filters.click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  expect((await box(sheet)).height).toBeGreaterThanOrEqual(840);
  const close = sheet.getByRole("button", { name: "Close the filters" });
  await expect(close).toBeFocused();
  // Shift+Tab from the first control goes to the last one inside the sheet, Tab from it back to the first.
  await page.keyboard.press("Shift+Tab");
  await expect(sheet.getByRole("button", { name: "Apply filters" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(filters).toBeFocused();

  await filters.click();
  const brand = sheet.getByRole("group", { name: "Brand" });
  const row = brand.locator("label").first();
  const rowBox = await box(row);
  expect(rowBox.height).toBeGreaterThanOrEqual(44);
  expect(rowBox.width).toBeGreaterThan(300);
  // A tap at the row's far end (not on the box or its words) ticks it.
  await page.mouse.click(rowBox.x + rowBox.width - 10, rowBox.y + rowBox.height / 2);
  await expect(brand.getByRole("checkbox").first()).toBeChecked();
  // The sticky Apply is on the screen without scrolling the sheet.
  await expect(sheet.getByRole("button", { name: "Apply filters" })).toBeInViewport();
  await sheet.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/f=brand%3Ademo-brand/);
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("link", { name: "Filters (1)", exact: true })).toBeVisible();
});

test("without a script the Filters link shows the form in place, and it applies", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...PHONE, javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/en/catalog");
  const apply = page.getByRole("button", { name: "Apply filters" });
  await expect(apply).toBeHidden();
  await page.getByRole("link", { name: "Filters", exact: true }).click();
  await expect(apply).toBeVisible();
  await page.getByRole("group", { name: "Price, UAH" }).getByLabel("From").fill("1000");
  await apply.click();
  await expect(page).toHaveURL(/\/en\/catalog\?price=100000\.\.$/);
  await context.close();
});

test("the cart is stacked cards with 44 px controls, and its total and checkout stay at the bottom (D-09)", async ({
  page,
  shopper,
}) => {
  for (const sku of ["DEMO-HOODIE-BLACK-S", "DEMO-HOODIE-BLUE-M"]) {
    const variant = await shopper.variantBySku("demo-hoodie", sku);
    await shopper.addToCart(variant.id, 1);
  }
  const tee = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-BLACK-M");
  await shopper.addToCart(tee.id, 1);
  await page.goto("/en/cart");
  await hydrated(page);
  const checkout = page.getByRole("link", { name: "Checkout", exact: true });
  // Three lines are taller than the screen: the checkout link is still on it, at the bottom.
  await expect(checkout).toBeInViewport();
  const linkBox = await box(checkout);
  expect(linkBox.y + linkBox.height).toBeGreaterThan(700);
  expect(linkBox.height).toBeGreaterThanOrEqual(44);
  expect(linkBox.width).toBeGreaterThan(300);
  for (const remove of await page.getByRole("button", { name: /^Remove / }).all()) {
    expect((await box(remove)).height).toBeGreaterThanOrEqual(44);
  }
  // The SKU fits on one line now.
  const sku = page.getByText("SKU: DEMO-HOODIE-BLACK-S");
  expect((await box(sku)).height).toBeLessThan(30);
  expect(await horizontalOverflow(page)).toBe(0);
});

test("the checkout shows the order collapsed above the form and a sticky 'Place the order' with the total (D-03)", async ({
  page,
  shopper,
}) => {
  const tee = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-BLACK-M");
  await shopper.addToCart(tee.id, 2);
  await page.goto("/en/checkout");
  await hydrated(page);
  const toggle = page.getByRole("button", { name: /^Your order/ });
  await expect(toggle).toBeInViewport();
  await expect(toggle).toContainText("2 items");
  await expect(toggle).toContainText("UAH 1,198.00");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const lines = page.getByRole("list", { name: "Items in the order" });
  await expect(lines).toBeHidden();
  await toggle.click();
  await expect(lines).toBeVisible();
  // Above the form.
  expect((await box(lines)).y).toBeLessThan(
    (await box(page.getByLabel("Email", { exact: true }))).y,
  );

  const submit = page.getByRole("button", { name: "Place the order" });
  await expect(submit).toBeInViewport();
  expect((await box(submit)).height).toBeGreaterThanOrEqual(48);
  // A focused field is never under the bar.
  const phone = page.getByLabel("Phone", { exact: true });
  await phone.focus();
  expect((await box(phone)).y + (await box(phone)).height).toBeLessThan((await box(submit)).y);
  expect(await horizontalOverflow(page)).toBe(0);
});

test("the order page keeps the number on one line and shows the link as a compact callout (D-10)", async ({
  page,
  shopper,
}, testInfo) => {
  const tee = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-BLACK-M");
  await shopper.addToCart(tee.id, 1);
  const order = await shopper.checkout({
    email: uniqueEmail(testInfo, "mobile-order"),
    idempotencyKey: randomUUID(),
    shipping: true,
  });
  await page.goto(`/uk/order/${order.number}#t=${String(order.accessToken)}`);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(`Замовлення ${order.number}`);
  const lineHeight = await heading.evaluate((element) =>
    parseFloat(getComputedStyle(element).lineHeight),
  );
  expect((await box(heading)).height).toBeLessThan(lineHeight * 1.5);
  const field = page.getByLabel("Посилання на ваше замовлення");
  const copy = page.getByRole("button", { name: "Скопіювати посилання" });
  // On a phone the button sits under a full-width field (review m5 of PR 216: beside it the field was 97 px).
  expect((await box(field)).width).toBeGreaterThan(300);
  expect((await box(copy)).y).toBeGreaterThan((await box(field)).y);
  expect((await box(copy)).height).toBeGreaterThanOrEqual(44);
  expect((await box(field)).y).toBeGreaterThan((await box(heading)).y);
  expect(await horizontalOverflow(page)).toBe(0);
});

test("touch targets: breadcrumbs 44 px, the card's brand is not a separate target (A-02, N5)", async ({
  page,
}) => {
  await page.goto("/en/p/demo-hoodie");
  const crumb = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link").first();
  expect((await box(crumb)).height).toBeGreaterThanOrEqual(44);
  await page.goto("/en/catalog");
  const brand = page.getByRole("link", { name: "Demo Brand" }).first();
  expect(await brand.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
});

for (const width of [360, 390, 768]) {
  test(`no horizontal scroll and no hydration error at ${String(width)} px`, async ({
    page,
    shopper,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const tee = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-BLACK-M");
    await shopper.addToCart(tee.id, 1);
    for (const path of [
      "/uk",
      "/uk/catalog",
      "/en/p/demo-hoodie",
      "/uk/cart",
      "/en/checkout",
      "/uk/search?q=demo",
    ]) {
      await page.goto(path);
      await hydrated(page);
      expect(await horizontalOverflow(page), path).toBe(0);
    }
    expect(errors.filter((line) => HYDRATION.test(line))).toEqual([]);
  });
}

// Review B1 of PR 216: the search icon is for phones and tablets only. An unlayered component class beat `lg:hidden`, so the
// icon showed between the category links and the search box on desktop; no test noticed.
for (const width of [1024, 1280]) {
  test.describe(`desktop ${String(width)} px`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: false, isMobile: false });

    test("the header has no search icon and keeps its one row: logo, search box, cart (review B1 of PR 216)", async ({
      page,
    }) => {
      await page.goto("/en/catalog");
      await hydrated(page);
      const header = page.getByRole("banner");
      await expect(header.locator('a[href="#site-search"]')).toBeHidden();
      await expect(header.getByRole("link", { name: "Search", exact: true })).toHaveCount(0);
      expect((await box(header)).height).toBeLessThanOrEqual(64);
      const logo = await box(header.getByRole("link", { name: "Fluxkit", exact: true }));
      const search = await box(header.getByRole("combobox", { name: "Search products" }));
      const cart = await box(header.getByRole("link", { name: /Cart/ }));
      const middle = (item: { y: number; height: number }) => item.y + item.height / 2;
      expect(Math.abs(middle(logo) - middle(search))).toBeLessThan(8);
      expect(Math.abs(middle(search) - middle(cart))).toBeLessThan(8);
      expect(logo.x).toBeLessThan(search.x);
      expect(search.x).toBeLessThan(cart.x);
    });

    test("without a script the header still has a working search box on a streamed page (review M2 of PR 216)", async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        javaScriptEnabled: false,
        baseURL,
      });
      const page = await context.newPage();
      await page.goto("/en/catalog");
      await page.getByRole("combobox", { name: "Search products" }).fill("screwdriver");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page).toHaveURL(/\/en\/search\?q=screwdriver$/);
      await context.close();
    });
  });
}
