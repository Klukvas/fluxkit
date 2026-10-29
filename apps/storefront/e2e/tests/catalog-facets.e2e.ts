import type { Page } from "@playwright/test";
import { E2E_SEARCH_ENABLED } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

// Catalog and category pages with search on (search plan step 10a, rest; owner answer 3): the list, the facets and the sort
// come from GET /store/search with the results page's URL state on the page's own path, and the page falls back to the SQL
// listing WITH a notice when search cannot answer. With `E2E_SEARCH=off` the API has search off and `search-off.e2e.ts`
// shows the catalog as before. An engine that is DOWN (503) is covered by unit specs (`catalog-page.spec.tsx`,
// `catalog-search-data.spec.ts`): it would need a second API with an unreachable engine; here the same fallback is reached
// through the API's per-address window (429), which this suite can use up for one test's address.
test.skip(
  !E2E_SEARCH_ENABLED,
  "needs the API with search on; E2E_SEARCH=off runs search-off.e2e.ts",
);

const resultCount = (page: Page) => page.locator("#search-results-heading");

async function countOf(page: Page): Promise<number> {
  return Number(((await resultCount(page).textContent()) ?? "").match(/\d+/)?.[0]);
}

test("the catalog lists through search: facets, sort and chips on its own address", async ({
  page,
}) => {
  const response = await page.goto("/en/catalog");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Filters" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Category" })).toBeVisible();
  await expect(page.getByLabel("Sort by")).toHaveValue("newest");
  await expect(resultCount(page)).toHaveText(/^\d+ products$/);
  await waitForHydration(page);
  const total = await countOf(page);
  expect(total).toBeGreaterThan(3);

  await page
    .getByRole("group", { name: "Color" })
    .getByRole("checkbox", { name: "Black", exact: true })
    .check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/\/en\/catalog\?f=opt\.color%3Ablack$/);
  await expect(resultCount(page)).toBeFocused();
  const black = await countOf(page);
  expect(black).toBeGreaterThan(0);
  expect(black).toBeLessThan(total);
  await expect(page.getByRole("list", { name: "Selected filters" })).toContainText("Color: Black");

  await page.getByLabel("Sort by").selectOption("price_desc");
  await expect(page).toHaveURL(/\/en\/catalog\?f=opt\.color%3Ablack&sort=price_desc$/);
  // A filtered view is not indexed; its canonical is the plain list.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/catalog$/);

  await page.getByRole("link", { name: "Clear all filters" }).click();
  await expect(page).toHaveURL(/\/en\/catalog\?sort=price_desc$/);
  expect(await countOf(page)).toBe(total);
});

test("a category page filters by its category and offers no category facet; its subcategories stay links", async ({
  page,
}) => {
  await page.goto("/en/c/demo-tools");
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Filters" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Category" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Brand" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Screwdrivers" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Demo Screwdriver" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Demo T-shirt" })).toHaveCount(0);

  await waitForHydration(page);
  await page.getByLabel("Sort by").selectOption("price_asc");
  await expect(page).toHaveURL(/\/en\/c\/demo-tools\?sort=price_asc$/);
  await expect(page.getByRole("heading", { level: 3, name: "Demo T-shirt" })).toHaveCount(0);
});

test("keeps ?brand= of the product pages working as the brand facet, and 404s words on a catalog page", async ({
  page,
}) => {
  const response = await page.goto("/en/catalog?brand=demo-brand");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/en\/catalog\?brand=demo-brand$/);
  await expect(
    page.getByRole("group", { name: "Brand" }).getByRole("checkbox", { name: /Demo Brand/ }),
  ).toBeChecked();
  const words = await page.goto("/en/catalog?q=shirt");
  expect(words?.status()).toBe(404);
});

test("falls back to the SQL listing and says so when search cannot answer (the shopper's window is used up)", async ({
  page,
}) => {
  // Every request of this test has the same client address; the storefront forwards it with the filtered (uncached) read.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await page.request.get("/store/search?locale=en");
    expect(response.status(), `search ${String(attempt + 1)}`).toBe(200);
  }
  expect((await page.request.get("/store/search?locale=en")).status()).toBe(429);

  const response = await page.goto("/en/catalog?f=opt.color%3Ablack&sort=price_asc");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();
  await expect(page.getByText("Filters are temporarily unavailable")).toBeVisible();
  await expect(page.getByText(/could not be applied/)).toBeVisible();
  // The SQL listing (newest first, without facets): the products are there, the filter panel is not.
  await expect(page.getByRole("heading", { level: 2, name: "Demo Screwdriver" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Filters" })).toHaveCount(0);
  // "Try again" keeps the address, so the filters come back with search.
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
    "href",
    "/en/catalog?f=opt.color%3Ablack&sort=price_asc",
  );
});
