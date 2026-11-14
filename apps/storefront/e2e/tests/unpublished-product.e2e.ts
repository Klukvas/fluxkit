import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";

/**
 * A product the shop takes back leaves its page within the catalog minute. The Next data cache keeps `200` answers only, so
 * a product page read through it kept the cached product after its unpublishing indefinitely (seen past 160 s): the
 * revalidation's `404` never replaced the entry. The storefront now keeps the product answer, found or not found, in its
 * own cache for `CATALOG_REVALIDATE_SECONDS` (`lib/store-data.ts`), so the page turns into a 404 at most 60 s after the
 * storefront last read the product. The test reloads until it does (`toPass`, at most 90 s: the bound plus a margin), and
 * again until the republished product is back, so no later file sees the wrench as missing.
 *
 * The wrench is no other file's product page (only a card in `card-add-to-cart`, which runs earlier).
 */
const SLUG = "demo-adjustable-wrench";
const PATH = `/en/p/${SLUG}`;
const CACHE_BOUND_MS = 90_000;

async function expectStatusWithinBound(page: Page, status: number): Promise<void> {
  await expect(async () => {
    const response = await page.goto(PATH);
    expect(response?.status()).toBe(status);
  }).toPass({ timeout: CACHE_BOUND_MS, intervals: [2_000] });
}

test("an unpublished product's page becomes a real 404 within the catalog minute, and comes back once republished", async ({
  page,
  shopper,
  admin,
}) => {
  test.setTimeout(2 * CACHE_BOUND_MS + 30_000);
  const product = await shopper.product(SLUG);

  const live = await page.goto(PATH);
  expect(live?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Demo Adjustable Wrench" }),
  ).toBeVisible();

  await admin.unpublishProduct(product.id);
  try {
    await expectStatusWithinBound(page, 404);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  } finally {
    await admin.publishProduct(product.id);
  }

  await expectStatusWithinBound(page, 200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Demo Adjustable Wrench" }),
  ).toBeVisible();
});
