import type { Page } from "@playwright/test";
import { E2E_SEARCH_ENABLED } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { sortButton, sortPanel, waitForHydration } from "../support/flows.ts";

// The sort of a faceted list as a disclosure of links with icons (owner feedback 2026-11-13, plan
// docs/plans/2026-11-13-storefront-ui-round-4.md B, council decision 5): keyboard use, the address, Escape, the 44 px rows,
// and the panel inside a 320 px screen. The sort exists only with search on (the faceted list).
test.skip(
  !E2E_SEARCH_ENABLED,
  "needs the API with search on; E2E_SEARCH=off runs search-off.e2e.ts",
);

const resultCount = (page: Page) => page.locator("#search-results-heading");

test("the sort opens by keyboard, a sort is chosen with Tab and Enter, and Escape gives the focus back", async ({
  page,
}) => {
  await page.goto("/en/catalog?view=list");
  await waitForHydration(page);
  const summary = sortButton(page);
  await expect(summary).toHaveAccessibleName("Sort by Newest");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  const panel = sortPanel(page);
  await expect(panel).toBeHidden();

  // Escape closes the open panel and returns the focus to the summary.
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("link")).toHaveText([
    "Newest",
    "Price: low to high",
    "Price: high to low",
  ]);
  await expect(panel.getByRole("link", { name: "Newest" })).toHaveAttribute("aria-current", "true");
  // Every row is at least 44 px tall and carries a decorative icon.
  for (const link of await panel.getByRole("link").all()) {
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(link.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  }
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("link", { name: "Newest" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(summary).toBeFocused();

  // Open again, Tab through the links to "Price: high to low", Enter: the address changes (view kept, page 1), the panel
  // closes and the focus moves to the result count like any other change of the results.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("link", { name: "Price: high to low" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/en\/catalog\?sort=price_desc&view=list$/);
  await expect(resultCount(page)).toBeFocused();
  await expect(summary).toHaveAccessibleName("Sort by Price: high to low");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await summary.click();
  await expect(panel.getByRole("link", { name: "Price: high to low" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  // The default sort's link writes nothing into the address.
  await expect(panel.getByRole("link", { name: "Newest" })).toHaveAttribute(
    "href",
    "/en/catalog?view=list",
  );
});

test("the open panel fits a 320 px screen next to the filters button", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  // The panel is native (`<details>`): it opens the same before and after hydration.
  await page.goto("/uk/catalog");
  // Below `lg` the sort shares its row with "Filters" (the layout where the panel has the least room).
  await expect(page.getByRole("link", { name: "Фільтри", exact: true })).toBeVisible();
  const summary = page.getByRole("button", { name: /^Сортування / });
  await summary.click();
  const panel = page.locator("details").filter({ has: summary }).getByRole("list");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
