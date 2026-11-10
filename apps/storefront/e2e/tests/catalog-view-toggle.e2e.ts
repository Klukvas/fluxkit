import type { Page } from "@playwright/test";
import { E2E_SEARCH_ENABLED } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { openLanguageMenu, waitForHydration } from "../support/flows.ts";

// The list/grid switch of the product lists (plan 2026-11-08-design-changeability.md, L2/L5; owner decision 2026-11-08: shipped,
// grid by default): `?view=list` renders the `list` card kind of the card registry, every filter, sort, page and language link
// keeps it, it never reaches the canonical URL, and an unknown value redirects to the address without it. The URL rules and
// that `view` is never sent to the API are unit specs (`search-query.spec.ts`, `catalog-query.spec.ts`, `search-data.spec.ts`).
test.skip(
  !E2E_SEARCH_ENABLED,
  "needs the API with search on (the catalog lists through search); the SQL listing's switch is a unit spec",
);

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

const viewGroup = (page: Page) => page.getByRole("group", { name: "Product list view" });
const products = (page: Page, name = "Products") => page.getByRole("list", { name });

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("the switch shows the list view and every filter, sort and language link keeps it", async ({
  page,
}) => {
  await page.goto("/en/catalog");
  const grid = viewGroup(page).getByRole("link", { name: "Grid" });
  const list = viewGroup(page).getByRole("link", { name: "List" });
  await expect(grid).toHaveAttribute("aria-current", "true");
  await expect(list).not.toHaveAttribute("aria-current", /.*/);
  const cards = await products(page).getByRole("article").count();
  expect(cards).toBeGreaterThan(1);

  await list.click();
  await expect(page).toHaveURL(/\/en\/catalog\?view=list$/);
  await expect(viewGroup(page).getByRole("link", { name: "List" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  // The same products, one per row: every card starts at the list's left edge.
  await expect(products(page).getByRole("article")).toHaveCount(cards);
  const lefts = await products(page)
    .getByRole("article")
    .evaluateAll((articles) => articles.map((article) => article.getBoundingClientRect().left));
  expect(new Set(lefts).size).toBe(1);
  // Presentation only: the canonical is the plain list.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/catalog$/);

  // A facet (the filter form carries the view), then the sort.
  await waitForHydration(page);
  await page.getByRole("group", { name: "Brand" }).getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/\/en\/catalog\?f=brand%3A[a-z0-9-]+&view=list$/);
  await page.getByLabel("Sort by").selectOption("price_desc");
  await expect(page).toHaveURL(/\/en\/catalog\?f=brand%3A[a-z0-9-]+&sort=price_desc&view=list$/);
  await expect(viewGroup(page).getByRole("link", { name: "List" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  // Removing the filter keeps the view too.
  await page.getByRole("link", { name: "Clear all filters" }).click();
  await expect(page).toHaveURL(/\/en\/catalog\?sort=price_desc&view=list$/);

  // The language switch keeps the whole address.
  await openLanguageMenu(page);
  const ukrainian = page.getByRole("link", { name: "Українська" });
  await expect(ukrainian).toHaveAttribute("href", "/uk/catalog?sort=price_desc&view=list");
  await ukrainian.click();
  await expect(page).toHaveURL(/\/uk\/catalog\?sort=price_desc&view=list$/);
  await expect(
    page
      .getByRole("group", { name: "Вигляд списку товарів" })
      .getByRole("link", { name: "Список" }),
  ).toHaveAttribute("aria-current", "true");

  // Back to the grid: the default writes nothing into the address.
  await page.getByRole("link", { name: "Сітка" }).click();
  await expect(page).toHaveURL(/\/uk\/catalog\?sort=price_desc$/);
});

test("the search results offer the same switch, and pages keep the view", async ({ page }) => {
  await page.goto("/en/search?q=demo&view=list");
  await expect(viewGroup(page).getByRole("link", { name: "List" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/en\/search\?q=demo$/,
  );
  await expect(products(page, "Search results").getByRole("article").first()).toBeVisible();
  // Every link of the results that stays on the page keeps the view (pages, chips, the filter reset).
  const hrefs = await page
    .getByRole("main")
    .locator('a[href^="/en/search"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  expect(hrefs.filter((href) => !href.includes("view=list"))).toEqual(["/en/search?q=demo"]);
});

test("an unknown view redirects to the address without it (no error page)", async ({ page }) => {
  const response = await page.goto("/en/catalog?view=tiles");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/en\/catalog$/);
  await expect(viewGroup(page).getByRole("link", { name: "Grid" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("at 390 px both views fit the width, and the switch works without a script", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...PHONE, javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/uk/catalog");
  expect(await horizontalOverflow(page)).toBe(0);
  await page
    .getByRole("group", { name: "Вигляд списку товарів" })
    .getByRole("link", { name: "Список" })
    .click();
  await expect(page).toHaveURL(/\/uk\/catalog\?view=list$/);
  await expect(products(page, "Товари").getByRole("article").first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);
  // The switch's 44 px links do not overlap the count above or the sort row below.
  const group = await page.getByRole("group", { name: "Вигляд списку товарів" }).boundingBox();
  expect(group?.height).toBeGreaterThanOrEqual(44);
  await context.close();
});
