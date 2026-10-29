import type { Page } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  E2E_API_PORT,
  E2E_ORIGIN,
  E2E_SEARCH_ENABLED,
  E2E_STOREFRONT_UNFORWARDED_PORT,
  clientMarker,
} from "../support/env.ts";
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

// Review F1 of the search finish (ADR 0040): the unfiltered lists are shared between shoppers, and a miss must neither
// count against the Next server's one window nor let one client add an entry per bogus address.
const fetchCache = resolve(import.meta.dirname, "../../.next/cache/fetch-cache");

function fetchCacheFiles(): number {
  return existsSync(fetchCache) ? readdirSync(fetchCache).length : 0;
}

test("pages past the last one cost no engine read and no cache entry, on either storefront (review F1)", async ({
  page,
  playwright,
}) => {
  // Warm up: the config and the categories of a catalog view are cached reads of their own (fixed addresses).
  expect((await page.request.get("/en/catalog?page=76")).status()).toBe(404);
  const direct = `http://127.0.0.1:${String(E2E_STOREFRONT_UNFORWARDED_PORT)}`;
  const client = await playwright.request.newContext();
  try {
    expect((await client.get(`${direct}/uk/catalog?page=76`)).status()).toBe(404);
    const before = fetchCacheFiles();
    // The review's scenario: one client asks for 74 addresses that cannot have a page, in a few seconds.
    for (let number = 2; number <= 75; number += 1) {
      const response = await page.request.get(`/en/catalog?page=${String(number)}`);
      expect(response.status(), `page ${String(number)}`).toBe(404);
    }
    // The same through the storefront without the forwarding, where every read is the Next server's own address.
    for (let number = 2; number <= 75; number += 1) {
      const response = await client.get(`${direct}/uk/catalog?page=${String(number)}`);
      expect(response.status(), `unforwarded page ${String(number)}`).toBe(404);
    }
    // The Next server's address (this runner reaches the API from the same address, without a forwarded one) still has
    // its window: before the fix, the 148 bogus pages had used it up (429).
    const server = await client.get(
      `http://127.0.0.1:${String(E2E_API_PORT)}/store/search?locale=en`,
    );
    expect.soft(server.status(), "the Next server's own window").toBe(200);
    // No entry per bogus address (before the fix: one file per page address).
    const after = fetchCacheFiles();
    expect(after, `data cache files: ${String(before)} before, ${String(after)} after`).toBe(
      before,
    );
  } finally {
    await client.dispose();
  }
});

test("a client that used up its own window cannot switch another shopper's plain lists to the fallback (review F1)", async ({
  page,
  browser,
}, testInfo) => {
  // Addresses no other test reads, different on a retry (a list stays shared for the catalog minute).
  const [mine, theirs] =
    testInfo.retry === 0
      ? [
          "/en/c/demo-tools-screwdrivers?sort=price_desc",
          "/en/c/demo-digital-templates?sort=price_desc",
        ]
      : ["/en/c/demo-clothing-shirts?sort=price_desc", "/en/c/demo-digital-books?sort=price_desc"];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    expect((await page.request.get("/store/search?locale=en")).status()).toBe(200);
  }
  expect((await page.request.get("/store/search?locale=en")).status()).toBe(429);

  // The miss of a plain list is read for the shopper whose view missed: this client's own window, so its page falls back.
  expect((await page.goto(mine))?.status()).toBe(200);
  await expect(page.getByText("Filters are temporarily unavailable")).toBeVisible();

  // Another shopper (own address) is not affected: a fresh plain list, and the very list the first client could not read.
  const other = await browser.newContext({
    baseURL: E2E_ORIGIN,
    extraHTTPHeaders: { "x-e2e-client": clientMarker(testInfo.testId, testInfo.retry, "other") },
  });
  try {
    const theirPage = await other.newPage();
    for (const address of [theirs, mine]) {
      expect((await theirPage.goto(address))?.status(), address).toBe(200);
      await expect(theirPage.getByRole("complementary", { name: "Filters" })).toBeVisible();
      await expect(theirPage.getByText("Filters are temporarily unavailable")).toHaveCount(0);
    }
  } finally {
    await other.close();
  }
});
