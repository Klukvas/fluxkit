import { E2E_SEARCH_ENABLED } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

// Search off (search plan step 10a): with `E2E_SEARCH=off` the API runs with `SEARCH_ENABLED=false` and `GET /store/config`
// says `search: false`. The header must not render a search box and the results page must not exist. Runs only in that mode
// (`E2E_SEARCH=off pnpm test:e2e`); every other suite runs in both modes, so the catalog without search stays covered.
test.skip(E2E_SEARCH_ENABLED, "needs the API with search off: run with E2E_SEARCH=off");

test("the config says search is off and the search routes answer 404", async ({ page }) => {
  const config = await page.request.get("/store/config");
  expect(((await config.json()) as { search: boolean }).search).toBe(false);
  expect((await page.request.get("/store/search?q=demo")).status()).toBe(404);
  expect((await page.request.get("/store/search/suggest?q=demo")).status()).toBe(404);
});

test("shows no search box in the header, in either locale", async ({ page }) => {
  for (const locale of ["en", "uk"]) {
    await page.goto(`/${locale}`);
    // The header is there (its cart link names the shop's locale), so an absent box is not an absent page.
    await expect(page.getByRole("banner").getByRole("link", { name: /cart|кошик/i })).toBeVisible();
    await expect(page.getByRole("search")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.locator('a[href$="/search"], form[action$="/search"]')).toHaveCount(0);
  }
});

test("the results page is a real 404, with or without words", async ({ page }) => {
  for (const path of ["/en/search", "/en/search?q=demo", "/uk/search?q=викрутка"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("search")).toHaveCount(0);
  }
});

test("the catalog still lists the products without search", async ({ page }) => {
  await page.goto("/en/catalog");
  await expect(page.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Demo Screwdriver" })).toBeVisible();
});
