import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { rowValue, tabTo, waitForHydration } from "../support/flows.ts";
import { SHOP_NAME } from "../support/shop-name.ts";

/**
 * Desktop design, batch A (plan `docs/plans/2026-11-03-storefront-design-a.md`): the product card's hover and alignment, the
 * product page's sticky summary, discount, SKU and sold-out values, the trust bar, the funnel steps, the 0-result search page,
 * the account breadcrumbs and one focus ring. Desktop 1280 unless a test says otherwise; it asserts what a shopper sees.
 */

const DESKTOP = { width: 1280, height: 800 };
test.use({ viewport: DESKTOP });

const cards = (page: Page): Locator => page.getByRole("main").getByRole("article");

/** The first row of the grid: the cards whose top is the first card's top. */
async function firstRow(page: Page): Promise<{ box: DOMRect; price: DOMRect }[]> {
  const boxes = await cards(page).evaluateAll((articles) =>
    articles.map((article) => {
      const price = [...article.querySelectorAll("span")].find(
        (span) => /UAH|₴/.test(span.textContent ?? "") && span.childElementCount === 0,
      );
      return {
        box: article.getBoundingClientRect().toJSON() as DOMRect,
        price: (price?.getBoundingClientRect().toJSON() ?? null) as DOMRect,
      };
    }),
  );
  const top = boxes[0]?.box.top;
  return boxes.filter((entry) => Math.abs(entry.box.top - (top ?? -1)) < 1);
}

for (const width of [1280, 1024]) {
  test(`catalog cards in a row have one height and one price line at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/en/catalog");
    await expect(cards(page).first()).toBeVisible();
    const row = await firstRow(page);
    expect(row.length).toBeGreaterThanOrEqual(3);
    const heights = row.map((entry) => Math.round(entry.box.height));
    expect(new Set(heights).size, `heights ${heights.join(", ")}`).toBe(1);
    const prices = row.map((entry) => Math.round(entry.price.bottom));
    expect(new Set(prices).size, `price bottoms ${prices.join(", ")}`).toBe(1);
  });
}

test("a card rises on hover (shadow and border tokens) and shows a stock badge only for exceptions", async ({
  page,
}) => {
  await page.goto("/en/catalog");
  const card = cards(page).filter({ hasText: "Demo Screwdriver" });
  await expect(card).toBeVisible();
  const style = () =>
    card.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { shadow: computed.boxShadow, border: computed.borderTopColor };
    });
  await page.mouse.move(0, 0);
  const resting = await style();
  expect(resting.shadow).toBe("none");
  await card.hover();
  await expect.poll(async () => (await style()).shadow).not.toBe("none");
  expect((await style()).border).not.toBe(resting.border);

  // Every card says its availability; only the exceptions are drawn. Earlier scenarios change stock in the shared database,
  // so each card is judged by what it says, not by its seed stock.
  const states = await cards(page).evaluateAll((articles) =>
    articles.map((article) => {
      const words = ["In stock", "Only a few left", "Out of stock"];
      const element = [...article.querySelectorAll("span")].find((span) =>
        words.includes(span.textContent?.trim() ?? ""),
      );
      return element === undefined
        ? null
        : { text: element.textContent?.trim(), hidden: element.className.includes("sr-only") };
    }),
  );
  expect(states.length).toBeGreaterThanOrEqual(4);
  for (const state of states) {
    expect(state).not.toBeNull();
    expect(state?.hidden, state?.text).toBe(state?.text === "In stock");
  }
});

test("the product page: a sticky summary on the right, the discount, the SKU in the specifications, the trust bar", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text());
  });
  await page.goto("/en/p/demo-t-shirt?opt.color=black&opt.size=m");
  await waitForHydration(page);
  const summary = page.locator("[data-product-summary]");
  const gallery = page.getByRole("group", { name: "Product images" });
  const summaryBox = await summary.boundingBox();
  const galleryBox = await gallery.boundingBox();
  expect(summaryBox && galleryBox && summaryBox.x > galleryBox.x + galleryBox.width).toBe(true);

  // The discount of 599 instead of 799 (25.03 %), rounded down, with spoken text.
  await expect(summary.getByText("−25%", { exact: true })).toBeVisible();
  await expect(summary.getByText("Save 25%", { exact: true })).toHaveCount(1);
  // The SKU left the summary for the specifications.
  await expect(summary.getByText(/DEMO-T-SHIRT/)).toHaveCount(0);
  await expect(rowValue(page.getByRole("region", { name: "Specifications" }), "SKU")).toHaveText(
    "DEMO-T-SHIRT-BLACK-M",
  );
  // The trust bar right under the purchase form.
  const trust = summary.getByRole("list", { name: "About your purchase" });
  await expect(trust.getByRole("listitem")).toHaveText([
    "Delivery across the country",
    "Secure payment",
    "Easy to contact us",
  ]);

  // Sticky: scrolling the long left column keeps the summary at the top of the viewport.
  await page.mouse.wheel(0, 500);
  await expect
    .poll(async () => Math.round((await summary.boundingBox())?.y ?? -1))
    .toBeLessThanOrEqual(32);
  expect((await summary.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
  await expect(page.getByRole("heading", { level: 1, name: "Demo T-shirt" })).toBeInViewport();
  expect(errors).toEqual([]);
});

test("description and specifications are open sections that close and open again", async ({
  page,
}) => {
  await page.goto("/en/p/demo-t-shirt");
  await waitForHydration(page);
  const heading = page.getByRole("heading", { level: 2, name: "Description" });
  await expect(heading).toBeVisible();
  const text = page.getByRole("region", { name: "Description" });
  await expect(text).toBeVisible();
  await heading.click();
  await expect(text).toBeHidden();
  await heading.click();
  await expect(text).toBeVisible();
});

test("a sold-out value is struck through but selectable, and the button says out of stock", async ({
  page,
}) => {
  // Red L of the T-shirt has no stock (seed); red S has.
  await page.goto("/en/p/demo-t-shirt?opt.color=red&opt.size=s");
  await waitForHydration(page);
  const size = page.getByRole("group", { name: "Size", exact: true });
  const large = size.getByRole("radio", { name: "L", exact: true });
  await expect(large).toBeEnabled();
  await expect(large).toHaveAccessibleDescription("out of stock");
  await expect(size.getByRole("radio", { name: "S", exact: true })).not.toHaveAccessibleDescription(
    "out of stock",
  );
  const largeLook = size.getByText("L", { exact: true });
  expect(await largeLook.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe(
    "line-through",
  );

  await size.getByText("L", { exact: true }).click();
  await expect(large).toBeChecked();
  await expect(page.getByRole("button", { name: "Out of stock" })).toBeDisabled();
  await expect(page.getByText("This option is out of stock. Choose another one.")).toBeVisible();
});

test("one focus ring: the logo, an option value and a gallery thumbnail show the ring token by keyboard", async ({
  page,
}) => {
  await page.goto("/en/p/demo-t-shirt");
  await waitForHydration(page);
  const ring = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--fk-color-ring").trim(),
  );
  const outline = (locator: Locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("span");
      probe.style.color = style.outlineColor;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return { style: style.outlineStyle, width: style.outlineWidth, color };
    });
  const ringColor = await page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, ring);

  const logo = page.getByRole("banner").getByRole("link", { name: SHOP_NAME.en });
  await tabTo(page, logo);
  expect(await outline(logo)).toEqual({ style: "solid", width: "2px", color: ringColor });

  const black = page
    .getByRole("group", { name: "Color", exact: true })
    .getByRole("radio", { name: "Black" });
  await tabTo(page, black);
  const blackLook = page
    .getByRole("group", { name: "Color", exact: true })
    .getByText("Black", { exact: true });
  expect(await outline(blackLook)).toEqual({ style: "solid", width: "2px", color: ringColor });

  const second = page.getByRole("button", { name: "Show image 2 of 3" });
  await tabTo(page, second);
  expect(await outline(second)).toEqual({ style: "solid", width: "2px", color: ringColor });
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("aria-pressed", "true");
});

test("the funnel: cart is step 1, checkout step 2 with a link back, the order page step 3, with the trust bar", async ({
  page,
  shopper,
}, testInfo) => {
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);

  await page.goto("/en/cart");
  await waitForHydration(page);
  const steps = page.getByRole("navigation", { name: "Checkout progress" });
  await expect(steps.locator('[aria-current="step"]')).toHaveText(/Cart/);
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("list", { name: "About your purchase" })).toBeVisible();

  await page.goto("/en/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await expect(steps.locator('[aria-current="step"]')).toHaveText(/Checkout/);
  await expect(steps.getByRole("link", { name: /Cart/ })).toHaveAttribute("href", "/en/cart");
  await expect(
    page
      .getByRole("region", { name: "Your order" })
      .getByRole("list", { name: "About your purchase" }),
  ).toBeVisible();

  const order = await shopper.checkout({
    email: uniqueEmail(testInfo, "funnel"),
    idempotencyKey: randomUUID(),
    shipping: true,
  });
  await page.goto(`/en/order/${order.number}#t=${order.accessToken ?? ""}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Order ${order.number}` }),
  ).toBeVisible();
  await expect(steps.locator('[aria-current="step"]')).toHaveText(/Order/);
  await expect(steps.getByRole("link")).toHaveCount(0);
});

test("on a phone the funnel collapses to 'Step 1 of 3' and the list stays for assistive technology", async ({
  page,
  shopper,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  await page.goto("/en/cart");
  await waitForHydration(page);
  await expect(page.getByText("Step 1 of 3: Cart")).toBeVisible();
  const steps = page.getByRole("navigation", { name: "Checkout progress" });
  await expect(steps.locator('[aria-current="step"]')).toHaveText(/Cart/);
  const list = steps.getByRole("list");
  expect(
    await list.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(1);
});

test("nothing found: no filter panel, the categories as a way on, the spelling hint kept", async ({
  page,
}) => {
  await page.goto("/en/search?q=zzzzqqqq");
  await expect(page.getByRole("heading", { name: "Nothing found" })).toBeVisible();
  await expect(page.getByText(/Check the spelling/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveCount(0);
  const categories = page.getByRole("navigation", { name: "Browse categories" });
  await expect(categories.getByRole("link", { name: "Clothing" })).toHaveAttribute(
    "href",
    "/en/c/demo-clothing",
  );
  await categories.getByRole("link", { name: "Tools" }).click();
  await expect(page).toHaveURL(/\/en\/c\/demo-tools$/);
});

test("account pages have breadcrumbs: Home / My account / section", async ({
  page,
  shopper,
}, testInfo) => {
  await shopper.register(uniqueEmail(testInfo, "crumbs"), "a-long-enough-password-1");
  await page.goto("/en/account/orders");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/en");
  await expect(crumbs.getByRole("link", { name: "My account" })).toHaveAttribute(
    "href",
    "/en/account",
  );
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText("My orders");
});

// Review of PR 217 (minors m1 to m4).

/** A CSS colour as the browser computes it, for comparing a computed style with a token. */
async function resolvedColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

test("the chosen option keeps its primary border under the mouse (review m1)", async ({ page }) => {
  await page.goto("/en/p/demo-t-shirt?opt.color=black&opt.size=m");
  await waitForHydration(page);
  const chosen = page
    .getByRole("group", { name: "Size", exact: true })
    .getByText("M", { exact: true });
  const other = page
    .getByRole("group", { name: "Size", exact: true })
    .getByText("S", { exact: true });
  const border = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).borderTopColor);
  const primary = await resolvedColor(page, "--fk-color-primary");
  const input = await resolvedColor(page, "--fk-color-border-input");
  await chosen.hover();
  expect(await border(chosen)).toBe(primary);
  // An unchosen value still answers the mouse.
  await other.hover();
  expect(await border(other)).toBe(input);
});

test("on a phone the hidden step list has no focus stop of its own (review m2, WCAG 2.4.7)", async ({
  page,
  shopper,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  await page.goto("/en/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await expect(page.getByText("Step 2 of 3: Checkout")).toBeVisible();
  const email = page.getByRole("textbox", { name: "Email" });
  const stops: { inSteps: boolean; width: number; height: number }[] = [];
  for (let step = 0; step < 60; step += 1) {
    if (await email.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const box = element.getBoundingClientRect();
        return {
          inSteps: element.closest('nav[aria-label="Checkout progress"]') !== null,
          width: box.width,
          height: box.height,
        };
      }),
    );
  }
  expect(await email.evaluate((element) => element === document.activeElement)).toBe(true);
  expect(stops.filter((stop) => stop.inSteps)).toEqual([]);
  expect(stops.filter((stop) => stop.width <= 1 || stop.height <= 1)).toEqual([]);
  // Screen readers still get the steps with the current one.
  await expect(
    page.getByRole("navigation", { name: "Checkout progress" }).locator('[aria-current="step"]'),
  ).toHaveText(/Checkout/);
});

test("on a phone the buy bar says 'Out of stock' for a sold-out variant, like the button (review m3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/p/demo-t-shirt?opt.color=red&opt.size=l");
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Out of stock" })).toBeDisabled();
  const bar = page.locator(".fk-bottom-bar.fixed");
  await expect(bar.locator("button").last()).toHaveText("Out of stock");
  await expect(bar.locator("button").last()).toBeDisabled();
});

test("the sticky summary never runs past a short viewport: it scrolls on its own (review m4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto("/en/p/demo-t-shirt?opt.color=black&opt.size=m");
  await waitForHydration(page);
  const summary = page.locator("[data-product-summary]");
  await page.mouse.wheel(0, 300);
  await expect
    .poll(async () => Math.round((await summary.boundingBox())?.y ?? -1))
    .toBeLessThanOrEqual(32);
  const box = await summary.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(480);
  // The button and the trust bar are reachable inside it.
  const add = summary.getByRole("button", { name: "Add to cart" });
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport();
  await summary.getByRole("list", { name: "About your purchase" }).scrollIntoViewIfNeeded();
  await expect(summary.getByRole("list", { name: "About your purchase" })).toBeInViewport();
});

test("the wheel over the sticky summary scrolls the page, not only over the left column (owner report 2026-11-13)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/en/p/demo-t-shirt?opt.color=black&opt.size=m");
  await waitForHydration(page);
  const box = await page.locator("[data-product-summary]").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + 40);
  await page.mouse.wheel(0, 400);
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
