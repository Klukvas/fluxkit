import { expect, test } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

test("a guest on a protected page is sent to the sign-in page with the page AND its query string as next (review L6)", async ({
  page,
}) => {
  await page.goto("/en/account/orders?page=3");
  await waitForHydration(page);
  await expect(page).toHaveURL(/\/en\/account\/login\?next=%2Fen%2Faccount%2Forders%3Fpage%3D3$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
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
