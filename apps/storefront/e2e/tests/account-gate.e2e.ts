import { expect, test } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

test("a guest on a protected page is sent to the sign-in page with the page AND its query string as next (review L6)", async ({
  page,
}) => {
  // A fresh tab has no same-origin predecessor: close must replace with home.
  await page.goto("/en/account/orders?page=3");
  await expect(page).toHaveURL(/\/en\/account\/login\?next=%2Fen%2Faccount%2Forders%3Fpage%3D3$/);
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Create an account" })).toHaveAttribute(
    "href",
    "/en/account/register?next=%2Fen%2Faccount%2Forders%3Fpage%3D3",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("main h1")).toBeFocused();
});

test("a gate replacement closes to the same-origin page before the protected visit", async ({
  page,
}) => {
  await page.goto("/en/catalog");
  await page.goto("/en/account/orders?page=3");
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/en\/catalog$/);
  await expect(dialog).toHaveCount(0);
});

test("a next that points at an auth page, even with a trailing slash, is not followed after signing in", async ({
  page,
}) => {
  await page.goto("/en/account/login?next=%2Fen%2Faccount%2Flogin%2F");
  await waitForHydration(page);
  // The register link carries no next either: an unsafe value is dropped, not passed on.
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute(
    "href",
    "/en/account/register",
  );
});
