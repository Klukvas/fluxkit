import { expect, test } from "../support/fixtures.ts";

for (const path of [
  "/en/p/no-such-product",
  "/en/c/no-such-category",
  "/en/catalog?page=9999",
  "/en/no-such-page",
]) {
  test(`${path} answers HTTP 404 and shows the not-found page`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to home" }).first()).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
}

test("the not-found page speaks the locale of the URL", async ({ page }) => {
  const response = await page.goto("/uk/p/no-such-product");
  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "uk");
  await expect(page.getByRole("heading", { level: 1, name: "Сторінку не знайдено" })).toBeVisible();
});
