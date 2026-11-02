import type { Request } from "@playwright/test";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { fillCheckoutForm, openAccountMenu, uah, waitForHydration } from "../support/flows.ts";

/**
 * The storefront UI polish of 2026-11-02 (plan `docs/plans/2026-11-02-storefront-ui-polish.md`): the header's icons and
 * menus, the cart's quantity that saves itself, the floating "Apply filters" button and the checkout phone field. They
 * assert what a shopper sees and what the browser sends; roles and names stand in for an axe run (not approved, HANDOFF).
 */

test("the header: an account menu by keyboard, Escape closes it, and the cart badge appears only above 0", async ({
  page,
  shopper,
}) => {
  await page.goto("/en");
  await waitForHydration(page);
  const cart = page.getByRole("banner").getByRole("link", { name: /^Cart/ });
  await expect(cart).toHaveAccessibleName(/0 items in the cart/);
  await expect(cart.locator(".bg-danger")).toHaveCount(0);

  const account = page.getByRole("banner").getByRole("button", { name: "Account menu" });
  await expect(account).toHaveAttribute("aria-expanded", "false");
  await account.focus();
  await page.keyboard.press("Enter");
  await expect(account).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Register" })).toBeHidden();
  await expect(account).toBeFocused();

  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 2);
  await page.reload();
  await waitForHydration(page);
  await expect(cart).toHaveAccessibleName(/2 items in the cart/);
  await expect(cart.locator(".bg-danger")).toHaveText("2");
});

test("the cart saves a quantity by itself: rapid clicks are one request, and the totals are the server's", async ({
  page,
  shopper,
}) => {
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  const writes: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/store/cart/items/")) {
      writes.push(request);
    }
  });
  await page.goto("/en/cart");
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Update" })).toHaveCount(0);
  const increase = page.getByRole("button", { name: "Increase quantity of Demo Screwdriver" });
  await increase.click();
  await increase.click();
  await increase.click();
  await expect(page.getByRole("spinbutton", { name: "Quantity of Demo Screwdriver" })).toHaveValue(
    "4",
  );
  await expect(page.getByRole("status").filter({ hasText: "Items: 4" })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]?.postDataJSON()).toEqual({ quantity: 4 });
  const total = await shopper.cartTotal();
  await expect(
    page
      .getByRole("definition")
      .filter({ hasText: uah(total.amount) })
      .first(),
  ).toBeVisible();
});

test("a refused quantity is restored with the reason next to the line", async ({
  page,
  shopper,
}) => {
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  // The API answers this write with a refused rule (staged here: the real limits need a 999 line).
  await page.route("**/store/cart/items/**", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({
      status: 409,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Rule violation",
        status: 409,
        code: "rule_violation",
        rule: "quantity_limit",
        detail: "x",
      }),
    });
  });
  await page.goto("/en/cart");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Increase quantity of Demo Screwdriver" }).click();
  const line = page.getByRole("list", { name: "Items in the cart" }).getByRole("listitem");
  await expect(line.getByRole("alert")).toContainText("The quantity was not changed");
  await expect(page.getByRole("spinbutton", { name: "Quantity of Demo Screwdriver" })).toHaveValue(
    "1",
  );
});

test("changing a filter shows an Apply button next to it; it applies the filters", async ({
  page,
}) => {
  await page.goto("/en/catalog");
  await waitForHydration(page);
  const floating = page.locator('#search-filters button[aria-hidden="true"]');
  await expect(floating).toBeHidden();
  const brand = page.getByRole("checkbox", { name: /Demo Brand/ });
  await brand.check();
  await expect(floating).toBeVisible();
  const [row, button] = [await brand.boundingBox(), await floating.boundingBox()];
  expect(Math.abs((row?.y ?? 0) - (button?.y ?? 1000))).toBeLessThan(40);
  await floating.click();
  await expect(page).toHaveURL(/\/en\/catalog\?f=brand%3Ademo-brand$/);
});

test("the checkout phone is shown in the national format, checked, and sent as E.164", async ({
  page,
  shopper,
}, testInfo) => {
  const book = await shopper.variantBySku("demo-e-book", "DEMO-E-BOOK");
  await shopper.addToCart(book.id, 1);
  await page.goto("/en/checkout");
  await waitForHydration(page);
  const phone = page.getByLabel("Phone", { exact: true });
  await phone.pressSequentially("0501234567");
  await expect(phone).toHaveValue("050 123 4567");

  await fillCheckoutForm(page, { email: uniqueEmail(testInfo, "phone") });
  await phone.fill("050 12");
  await page.getByRole("button", { name: "Place the order" }).click();
  await expect(phone).toBeFocused();
  await expect(page.getByText(/The number is too short/).first()).toBeVisible();
  await expect(phone).toHaveAttribute("aria-invalid", "true");

  await phone.fill("050 123 4567");
  const sent = page.waitForRequest((request) => request.url().includes("/store/checkout"));
  await page.getByRole("button", { name: "Place the order" }).click();
  expect((await sent).postDataJSON()).toMatchObject({ phone: "+380501234567" });
});

test("the account pages have a side menu that marks the current section; 'Your data' is 'Privacy and data'", async ({
  page,
  shopper,
}, testInfo) => {
  await shopper.register(uniqueEmail(testInfo, "nav"), "a-Long-Password-123");
  await page.goto("/en/account/orders");
  const sections = page.getByRole("navigation", { name: "Account sections" });
  await expect(sections.getByRole("link", { name: "My orders" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await sections.getByRole("link", { name: "Privacy and data" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy and data" })).toBeVisible();
  await expect(sections.getByRole("link", { name: "Privacy and data" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await openAccountMenu(page, "Account: Api");
  await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("a quantity still saving when Checkout is pressed is not lost: the link waits for it (review M1 of PR 211)", async ({
  page,
  shopper,
}) => {
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  // Every quantity write answers slowly, so the second click happens while the first request runs.
  await page.route("**/store/cart/items/**", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return route.fallback();
  });
  await page.goto("/en/cart");
  await waitForHydration(page);
  const increase = page.getByRole("button", { name: "Increase quantity of Demo Screwdriver" });
  const firstWrite = page.waitForRequest(
    (request) => request.method() === "PATCH" && request.url().includes("/store/cart/items/"),
  );
  await increase.click();
  await firstWrite; // the request for 2 is in flight
  await increase.click(); // 3, while it runs
  const checkout = page.getByRole("link", { name: /^(Checkout|Saving your changes)/ });
  await checkout.click();
  await expect(checkout).toHaveText("Saving your changes…");
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible({
    timeout: 15_000,
  });
  const cart = (await (await page.request.get("/store/cart")).json()) as {
    lines: { quantity: number }[];
  };
  expect(cart.lines[0]?.quantity).toBe(3);
});

test("the header is one row of controls at 1280 in uk and en, and at 390 the controls stay in one row too", async ({
  page,
}) => {
  for (const [width, locale] of [
    [1280, "uk"],
    [1280, "en"],
    [390, "uk"],
    [390, "en"],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/${locale}`);
    await waitForHydration(page).catch(() => undefined);
    const tops = await page.locator("header > div > *").evaluateAll((items) =>
      items
        .filter((item) => item.getBoundingClientRect().width > 0)
        .filter((item) => item.querySelector('[role="search"]') === null)
        .map((item) => Math.round(item.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size, `${String(width)} ${locale}: ${JSON.stringify(tops)}`).toBe(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `${String(width)} ${locale}: no horizontal scroll`).toBe(false);
  }
});

test("the header in Ukrainian: one dropdown open at a time, panels inside a 390 px screen, sign-out from the account menu", async ({
  page,
  shopper,
}, testInfo) => {
  await shopper.register(uniqueEmail(testInfo, "header-uk"), "a-Long-Password-123");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/uk");
  await expect(page.getByRole("banner").getByRole("link", { name: /^Кошик/ })).toHaveAccessibleName(
    /товарів у кошику/,
  );
  const language = page.getByRole("button", { name: "Мова сайту: Українська" });
  const account = page.getByRole("banner").getByRole("button", { name: "Акаунт: Api" });
  await language.click();
  await expect(page.getByRole("link", { name: "English" })).toBeVisible();
  for (const panel of await page.locator("header details[open] > div").all()) {
    const box = await panel.boundingBox();
    expect(box !== null && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  }
  await account.click();
  await expect(language).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: "English" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Мої замовлення" })).toBeVisible();
  const box = await page.locator("header details[open] > div").boundingBox();
  expect(box !== null && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  // Sign out on the home page: the menu closes and the header shows a guest.
  await page.getByRole("banner").getByRole("button", { name: "Вийти" }).click();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Меню акаунта" }),
  ).toBeVisible();
  await expect(page.locator("header details[open]")).toHaveCount(0);
});
