import type { Locator, Page, Request } from "@playwright/test";
import { E2E_SEARCH_ENABLED, E2E_STOREFRONT_UNFORWARDED_PORT } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

// Catalog search, storefront side (search plan step 10a): the header box with suggestions, the results page, its facets, sort
// and price, the states, and the per-address window of the API reached through the Next server. Runs against the real engine
// with the seeded demo catalog (`prepare-database.ts` creates the scoped key and builds the index). With `E2E_SEARCH=off`
// the API has search off and `search-off.e2e.ts` runs instead.
test.skip(
  !E2E_SEARCH_ENABLED,
  "needs the API with search on; E2E_SEARCH=off runs search-off.e2e.ts",
);

const searchBox = (page: Page) => page.getByRole("combobox", { name: "Search products" });
const resultCount = (page: Page) => page.locator("#search-results-heading");

/** React has hydrated the element when it carries its props (works in any locale, unlike the cart badge's English name). */
async function waitForReact(element: Locator): Promise<void> {
  await expect
    .poll(() =>
      element.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps"))),
    )
    .toBe(true);
}

/** The suggestion requests the browser sends (the typed text only). */
function watchSuggestRequests(page: Page): { texts: string[]; failed: Request[] } {
  const texts: string[] = [];
  const failed: Request[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/store/search/suggest") texts.push(url.searchParams.get("q") ?? "");
  });
  page.on("requestfailed", (request) => failed.push(request));
  return { texts, failed };
}

test.describe("the header search box", () => {
  test("suggests while typing and opens a suggestion with the keyboard alone (ARIA combobox)", async ({
    page,
  }) => {
    await page.goto("/en");
    await waitForHydration(page);
    const box = searchBox(page);
    await expect(box).toHaveAttribute("aria-expanded", "false");
    await box.click();
    await box.pressSequentially("screw", { delay: 40 });

    const option = page.getByRole("option", { name: "Demo Screwdriver" });
    await expect(option).toBeVisible();
    await expect(box).toHaveAttribute("aria-expanded", "true");
    // The live region says how many, for a screen reader (the focus stays in the box).
    await expect(page.getByRole("status").filter({ hasText: /suggestions?\./ })).toHaveCount(1);
    await expect(box).toHaveAttribute("aria-controls", /.+/);
    await expect(box).not.toHaveAttribute("aria-activedescendant", /.+/);

    await box.press("ArrowDown");
    await expect(option).toHaveAttribute("aria-selected", "true");
    await expect(box).toHaveAttribute(
      "aria-activedescendant",
      (await option.getAttribute("id")) ?? "",
    );
    await expect(box).toBeFocused();

    await box.press("Enter");
    await expect(page).toHaveURL(/\/en\/p\/demo-screwdriver$/);
    await expect(page.getByRole("heading", { level: 1, name: "Demo Screwdriver" })).toBeVisible();
  });

  test("Escape closes the list and keeps the text; Enter with nothing highlighted searches", async ({
    page,
  }) => {
    await page.goto("/en");
    await waitForHydration(page);
    const box = searchBox(page);
    await box.click();
    await box.pressSequentially("screwdriver", { delay: 40 });
    await expect(page.getByRole("option", { name: "Demo Screwdriver" })).toBeVisible();
    await box.press("Escape");
    await expect(box).toHaveAttribute("aria-expanded", "false");
    await expect(box).toHaveValue("screwdriver");
    await expect(box).toBeFocused();

    await box.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-expanded", "true");
    await box.press("ArrowUp");
    await box.press("Escape");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/en\/search\?q=screwdriver$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Results for “screwdriver”" }),
    ).toBeVisible();
    // The box holds the words of the page, so they can be refined.
    await expect(searchBox(page)).toHaveValue("screwdriver");
    await expect(page.getByRole("heading", { level: 3, name: "Demo Screwdriver" })).toBeVisible();
  });

  test("asks only from 2 characters, once after a pause, and aborts the request of text typed past", async ({
    page,
  }) => {
    await page.goto("/en");
    await waitForHydration(page);
    const { texts, failed } = watchSuggestRequests(page);
    let held = 0;
    await page.route("**/store/search/suggest?*", async (route) => {
      held += 1;
      // The first answer never comes: only an abort can end that request.
      if (held === 1) return;
      await route.continue();
    });
    const box = searchBox(page);
    await box.click();
    await box.pressSequentially("s", { delay: 40 });
    await page.waitForTimeout(700);
    expect(texts, "one character sends nothing").toEqual([]);

    await box.pressSequentially("c", { delay: 40 });
    await expect.poll(() => texts).toEqual(["sc"]);
    await box.pressSequentially("rew", { delay: 40 });
    await expect.poll(() => texts).toEqual(["sc", "screw"]);
    await expect
      .poll(() => failed.map((request) => request.failure()?.errorText ?? ""))
      .toContainEqual(expect.stringContaining("ERR_ABORTED"));
    await expect(page.getByRole("option", { name: "Demo Screwdriver" })).toBeVisible();
  });

  test("keeps working without a script: the box is a GET form to the results page", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto("/en");
    await page.getByRole("combobox", { name: "Search products" }).fill("screwdriver");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=screwdriver$/);
    await expect(page.getByRole("heading", { level: 3, name: "Demo Screwdriver" })).toBeVisible();
    await context.close();
  });

  test("answers in Ukrainian with the locale's own words and results", async ({ page }) => {
    await page.goto("/uk");
    const box = page.getByRole("combobox", { name: "Пошук товарів" });
    await waitForReact(box);
    await box.fill("викрутка");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/uk\/search\?q=/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Результати за запитом «викрутка»" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Демо викрутка" })).toBeVisible();
  });
});

test.describe("the results page", () => {
  test("shows words, count, sort, filters and the products as a server-rendered page", async ({
    page,
  }) => {
    const response = await page.goto("/en/search?q=demo");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Results for “demo”" })).toBeVisible();
    await expect(resultCount(page)).toHaveText(/^\d+ products? found$/);
    await expect(page.getByRole("complementary", { name: "Filters" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Brand" })).toBeVisible();
    await expect(page.getByRole("group", { name: /^Price, UAH$/ })).toBeVisible();
    await expect(page.getByLabel("Sort by")).toHaveValue("relevance");
    // Noindex, and a canonical that is the words alone.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/en\/search\?q=demo$/,
    );
    await expect(page).toHaveTitle(/^Search: demo/);
  });

  test("changes the sort and the price in the address, keeps the words, and moves the focus to the count", async ({
    page,
  }) => {
    await page.goto("/en/search?q=demo");
    await waitForHydration(page);
    const total = Number(((await resultCount(page).textContent()) ?? "").match(/\d+/)?.[0]);
    expect(total).toBeGreaterThan(3);

    await page.getByLabel("Sort by").selectOption("price_desc");
    await expect(page).toHaveURL(/\/en\/search\?q=demo&sort=price_desc$/);
    await expect(resultCount(page)).toBeFocused();
    await expect(page.getByLabel("Sort by")).toHaveValue("price_desc");

    await page.getByRole("group", { name: "Price, UAH" }).getByLabel("From").fill("1000");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=demo&price=100000\.\.&sort=price_desc$/);
    await expect(resultCount(page)).toBeFocused();
    const filtered = Number(((await resultCount(page).textContent()) ?? "").match(/\d+/)?.[0]);
    expect(filtered).toBeLessThan(total);
    expect(filtered).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { level: 3, name: "Demo T-shirt" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Selected filters" })).toContainText(
      "Price, UAH: From 1000",
    );

    // The chip removes just that filter, the sort and the words stay.
    await page.getByRole("link", { name: /^Remove the filter: Price/ }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=demo&sort=price_desc$/);
  });

  test("tells the shopper which price is wrong instead of sending it, and focuses the box", async ({
    page,
  }) => {
    await page.goto("/en/search?q=demo");
    await waitForHydration(page);
    const group = page.getByRole("group", { name: "Price, UAH" });
    await group.getByLabel("From").fill("abc");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.locator("form#search-filters").getByRole("alert")).toContainText(
      "Enter the lowest price as a number",
    );
    await expect(group.getByLabel("From")).toBeFocused();
    await expect(group.getByLabel("From")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/en\/search\?q=demo$/);

    await group.getByLabel("From").fill("50");
    await group.getByLabel("To").fill("10");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.locator("form#search-filters").getByRole("alert")).toContainText(
      "must not be above the highest",
    );
    await expect(page).toHaveURL(/\/en\/search\?q=demo$/);
  });

  test("filters by a facet value, shows the chip and clears it", async ({ page }) => {
    await page.goto("/en/search?q=demo");
    await waitForHydration(page);
    const brand = page.getByRole("group", { name: "Brand" });
    await brand.getByRole("checkbox", { name: /Demo Brand/ }).check();
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=demo&f=brand%3Ademo-brand$/);
    await expect(page.getByRole("list", { name: "Selected filters" })).toContainText(
      "Brand: Demo Brand",
    );
    await expect(page.getByRole("checkbox", { name: /Demo Brand/ })).toBeChecked();
    await page.getByRole("link", { name: "Clear all filters" }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=demo$/);
    await expect(page.getByRole("checkbox", { name: /Demo Brand/ })).not.toBeChecked();
  });

  test("narrows by an option of the product type (data, not a field of the page) and by two values of one facet", async ({
    page,
  }) => {
    await page.goto("/en/search?q=demo");
    await waitForHydration(page);
    const total = Number(((await resultCount(page).textContent()) ?? "").match(/\d+/)?.[0]);
    const color = page.getByRole("group", { name: "Color" });
    // Option values are variant-level: listed without counts (ADR 0034 decision 4), never with a made-up number.
    await expect(color.getByRole("checkbox", { name: "Black", exact: true })).toBeVisible();
    await color.getByRole("checkbox", { name: "Black", exact: true }).check();
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=demo&f=opt\.color%3Ablack$/);
    await expect(page.getByRole("list", { name: "Selected filters" })).toContainText(
      "Color: Black",
    );
    const black = Number(((await resultCount(page).textContent()) ?? "").match(/\d+/)?.[0]);
    expect(black).toBeGreaterThan(0);
    expect(black).toBeLessThan(total);

    // Two values of the same facet are alternatives (OR): the result grows.
    await page
      .getByRole("group", { name: "Color" })
      .getByRole("checkbox", { name: "Blue", exact: true })
      .check();
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=demo&f=opt\.color%3Ablack&f=opt\.color%3Ablue$/);
    const either = Number(((await resultCount(page).textContent()) ?? "").match(/\d+/)?.[0]);
    expect(either).toBeGreaterThanOrEqual(black);
  });

  test("lists the products of every word-less search with its filters (browsing), under its own heading", async ({
    page,
  }) => {
    await page.goto("/en/search");
    await expect(page.getByRole("heading", { level: 1, name: "All products" })).toBeVisible();
    await expect(page.getByLabel("Sort by").locator("option")).toHaveText([
      "Newest",
      "Price: low to high",
      "Price: high to low",
    ]);
    await expect(resultCount(page)).toHaveText(/^\d+ products found$/);
  });

  test("works without a script: the filter form is a GET form that ends on the short address", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/en/search?q=demo");
    await page.getByRole("group", { name: "Price, UAH" }).getByLabel("From").fill("1000");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=demo&price=100000\.\.$/);
    // A box the page refuses (the browser's pattern lets a reversed range through) is the form's own state, not a 404.
    const price = page.getByRole("group", { name: "Price, UAH" });
    await price.getByLabel("From").fill("20");
    await price.getByLabel("To").fill("10");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/priceMin=20&priceMax=10/);
    await expect(page.getByText("Check the filters")).toBeVisible();
    await expect(page.getByText("The lowest price must not be above the highest.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Results for “demo”");
    await context.close();
  });

  test("redirects a hand-made form address to the short one and refuses malformed parameters with a real 404", async ({
    page,
  }) => {
    await page.goto("/en/search?q=demo&priceMin=1000&sort=");
    await expect(page).toHaveURL(/\/en\/search\?q=demo&price=100000\.\.$/);
    for (const bad of [
      "page=0",
      "page=418",
      "sort=cheapest",
      "price=abc",
      "f=nocolon",
      "price=500..100",
    ]) {
      const response = await page.goto(`/en/search?q=demo&${bad}`);
      expect(response?.status(), bad).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    }
  });

  test("shows nothing found with a way out, and an unknown facet as an explained state", async ({
    page,
  }) => {
    await page.goto("/en/search?q=zzzzqqqq");
    await expect(page.getByRole("heading", { name: "Nothing found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse the catalog" })).toHaveAttribute(
      "href",
      "/en/catalog",
    );
    await expect(resultCount(page)).toHaveText("0 products found");

    await page.goto("/en/search?q=demo&f=opt.nosuch%3Avalue");
    await expect(page.getByText("These filters are not available")).toBeVisible();
    await page.getByRole("link", { name: "Clear the filters" }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=demo$/);
  });

  test("renders what was typed as text, never as markup", async ({ page }) => {
    const hostile = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    await page.goto(`/en/search?q=${encodeURIComponent(hostile)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Results for “${hostile}”`);
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
    await expect(page.locator("main img[src='x']")).toHaveCount(0);
    await expect(page.locator("main script")).toHaveCount(0);
  });

  test("counts the shopper, not the Next server, against the API's 60 a minute window, and says so when it is used up", async ({
    page,
  }) => {
    // Every request of this test has the same address (the proxy sets it from the test's marker). The page's own search is
    // rendered by the Next server, which passes that address on (it runs with STOREFRONT_FORWARD_CLIENT_ADDRESS=true, ADR
    // 0037); if it did not, the window used up here would not be seen.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await page.request.get("/store/search?q=demo&locale=en");
      expect(response.status(), `search ${String(attempt + 1)}`).toBe(200);
    }
    const limited = await page.request.get("/store/search?q=demo&locale=en");
    expect(limited.status()).toBe(429);
    await page.goto("/en/search?q=demo");
    await expect(page.getByText("Too many searches")).toBeVisible();
    await expect(page.getByText(/Try again in \d+ seconds?\./)).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse the catalog" }).last()).toBeVisible();
  });

  test("passes no client address on with STOREFRONT_FORWARD_CLIENT_ADDRESS off: an invented one is ignored and every shopper shares the Next server's window", async ({
    playwright,
  }) => {
    // The second `next start` of the config, reached directly as a client that got around the edge would: it names a new
    // address on every request. Counted per named address, it would never meet the limit; it does, within 61 pages, because
    // the Next server's own address is counted (one window for everybody, ADR 0037).
    const direct = `http://127.0.0.1:${String(E2E_STOREFRONT_UNFORWARDED_PORT)}`;
    const client = await playwright.request.newContext();
    try {
      let limitedAt = 0;
      for (let attempt = 1; attempt <= 61 && limitedAt === 0; attempt += 1) {
        const response = await client.get(`${direct}/en/search?q=demo`, {
          headers: { "X-Forwarded-For": `203.0.113.${String(attempt)}` },
        });
        expect(response.status(), `page ${String(attempt)}`).toBe(200);
        if ((await response.text()).includes("Too many searches")) limitedAt = attempt;
      }
      expect(limitedAt, "the shared window was used up").toBeGreaterThan(0);
      const another = await client.get(`${direct}/en/search?q=demo`, {
        headers: { "X-Forwarded-For": "198.51.100.77" },
      });
      expect(await another.text()).toContain("Too many searches");
    } finally {
      await client.dispose();
    }
  });
});
