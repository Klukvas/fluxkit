import { expect, test } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

test("after a client-side navigation the focus is on the new page's heading (review L9)", async ({
  page,
}) => {
  await page.goto("/en");
  await waitForHydration(page);
  // The first page load does not move the focus.
  await expect(page.locator("main h1").first()).not.toBeFocused();

  await page.getByRole("link", { name: "Catalog", exact: true }).first().click();
  await expect(page).toHaveURL(/\/en\/catalog$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  // The next Tab goes into the page, not back to the header's language switcher.
  await page.keyboard.press("Tab");
  const inMain = await page.evaluate(() =>
    document.querySelector("main")?.contains(document.activeElement),
  );
  expect(inMain).toBe(true);
});
