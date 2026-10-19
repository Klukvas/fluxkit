import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { chooseOptions, fillCheckoutForm, orderNumberOnPage, tokenOf } from "../support/flows.ts";

test("a guest buys a T-shirt from the home page and manages the order through its private link", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/en");
  await page
    .getByRole("link", { name: /Demo T-shirt/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/en\/p\/demo-t-shirt$/);
  await expect(page.getByRole("heading", { level: 1, name: "Demo T-shirt" })).toBeVisible();

  await chooseOptions(page, { Color: "White", Size: "M" });
  await expect(page.getByText("SKU: DEMO-T-SHIRT-WHITE-M")).toBeVisible();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("status").getByText("Added to the cart.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Cart.*1 item in the cart/ })).toBeVisible();

  await page.getByRole("link", { name: "Go to the cart" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cart" })).toBeVisible();
  const line = page.getByRole("list", { name: "Items in the cart" }).locator(":scope > li");
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("Demo T-shirt");
  await expect(line).toContainText("Color: White");
  await expect(line).toContainText("Size: M");

  await page.getByRole("link", { name: "Checkout" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  // The cart ships, so the address is asked for.
  await expect(page.getByRole("heading", { name: "Shipping address" })).toBeVisible();
  await fillCheckoutForm(page, { email: uniqueEmail(testInfo, "guest") });
  await page.getByRole("button", { name: "Place the order" }).click();

  // Client-side navigation from the checkout: the fragment must survive it and hydration.
  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=[A-Za-z0-9_-]{16,}$/);
  const link = page.url();
  const token = tokenOf(link);
  const number = await orderNumberOnPage(page);
  await expect(page).toHaveURL(new RegExp(`/en/order/${number}#t=`));
  await expect(page.getByText("Awaiting payment", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Items of the order" })).toContainText(
    "Demo T-shirt",
  );
  // The attempt (idempotency key and hash) is removed once the order exists.
  expect(
    await page.evaluate(() => window.sessionStorage.getItem("fluxkit.checkoutAttempt")),
  ).toBeNull();

  // "Save this link": the field holds the full private link and the button copies it.
  const field = page.getByLabel("Link to your order");
  await expect(field).toHaveValue(link);
  await page.getByRole("button", { name: "Copy the link" }).click();
  await expect(page.getByText("The link is copied.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // The link is the way back: reloading it (the token comes from the fragment, after hydration) shows the same order.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: `Order ${number}` })).toBeVisible();
  await expect(page).toHaveURL(link);
  expect(tokenOf(page.url())).toBe(token);

  // Cancel it: a confirmation step first, then the status changes and stays changed after a reload.
  await page.getByRole("button", { name: "Cancel the order" }).click();
  await expect(page.getByText("Cancel this order? This cannot be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Yes, cancel the order" }).click();
  await expect(page.getByText("The order is cancelled.")).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel the order" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
});
