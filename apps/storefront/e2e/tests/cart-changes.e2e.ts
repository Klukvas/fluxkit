import { randomUUID } from "node:crypto";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { fillCheckoutForm, orderNumberOnPage, storedAttempt, uah } from "../support/flows.ts";

test("a price changed by the admin between the cart and the checkout blocks the order until it is acknowledged, then the order is placed at the new total", async ({
  page,
  shopper,
  admin,
}, testInfo) => {
  const product = await shopper.product("demo-linen-shirt");
  const shirt = await shopper.variantBySku("demo-linen-shirt", "DEMO-LINEN-SHIRT-WHITE-L");
  const oldPrice = shirt.price.amount;
  const newPrice = oldPrice + 10_000;
  await shopper.addToCart(shirt.id, 1);

  await page.goto("/en/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await fillCheckoutForm(page, { email: uniqueEmail(testInfo, "price") });
  await expect(page.getByRole("button", { name: "Place the order" })).toBeEnabled();

  // Behind the shopper's back the price goes up. The page still shows the old one.
  await admin.setPrice(product.id, shirt.id, newPrice);
  await page.getByRole("button", { name: "Place the order" }).click();

  // 409 cart_changed: the fresh cart replaces the shown one, the change is explained and the submit is blocked.
  await expect(page.getByText("Prices have changed")).toBeVisible();
  await expect(page.getByText(`Was ${uah(oldPrice)}, now ${uah(newPrice)}`)).toBeVisible();
  await expect(
    page.getByText("Prices in your cart have changed. Check them and press OK to continue."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Place the order" })).toBeDisabled();

  // The shopper accepts the new prices (POST /store/cart/acknowledge): that OK is the consent to the new total, so the
  // summary shows it and the submit is free again (the separate "Confirm the new total" step is for changes without a price notice).
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByText("Prices have changed")).toHaveCount(0);
  const summary = page.getByRole("region", { name: "Your order" });
  await expect(
    summary
      .getByRole("term")
      .filter({ hasText: /^Total$/ })
      .locator("xpath=following-sibling::*[1]"),
  ).toHaveText(uah(newPrice));
  await expect(page.getByRole("button", { name: "Confirm the new total" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Place the order" })).toBeEnabled();
  await page.getByRole("button", { name: "Place the order" }).click();

  // The order is placed at the NEW price, which the order page shows as its total.
  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=/);
  await orderNumberOnPage(page);
  const totals = page.getByRole("region", { name: "Totals" });
  await expect(totals.getByText(uah(newPrice)).first()).toBeVisible();
  await expect(totals).not.toContainText(uah(oldPrice));
});

test("the last unit sold to another session refuses the checkout on its line, and a retry keeps the idempotency key", async ({
  page,
  shopper,
  otherShopper,
  admin,
}, testInfo) => {
  const product = await shopper.product("demo-hammer");
  const hammer = await shopper.variantBySku("demo-hammer", "DEMO-HAMMER");
  await admin.leaveOneUnit(product.id, hammer.id);
  await shopper.addToCart(hammer.id, 1);

  const keys: (string | undefined)[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/store/checkout")) keys.push(request.headers()["idempotency-key"]);
  });
  const email = uniqueEmail(testInfo, "last-unit");
  await page.goto("/en/checkout");
  await fillCheckoutForm(page, { email });
  await expect(page.getByRole("button", { name: "Place the order" })).toBeEnabled();

  // Another session buys the last unit while this shopper is typing.
  await otherShopper.addToCart(hammer.id, 1);
  await otherShopper.checkout({
    email: uniqueEmail(testInfo, "other"),
    idempotencyKey: randomUUID(),
    shipping: true,
  });

  await page.getByRole("button", { name: "Place the order" }).click();
  await expect(
    page.getByText("Not every item in the cart can be ordered. Check the marked items."),
  ).toBeVisible();
  const line = page.getByRole("list", { name: "Items in the order" }).getByRole("listitem");
  await expect(line).toContainText("Cannot be ordered: Not enough stock available.");
  await expect(page).toHaveURL(/\/en\/checkout$/);
  await expect(page.getByRole("button", { name: "Place the order" })).toBeEnabled();
  expect(keys).toHaveLength(1);

  // The refusal keeps the attempt: an idempotency key and a hash, no personal data, and it survives a reload.
  const attempt = await storedAttempt(page);
  expect(attempt).not.toBeNull();
  expect(Object.keys(JSON.parse(attempt ?? "{}") as object).sort()).toEqual(["key", "requestHash"]);
  expect(attempt).not.toContain(email);
  await page.reload();
  expect(await storedAttempt(page)).toBe(attempt);

  // The same request again (the form is not kept across a reload, on purpose) reuses the same key ...
  await fillCheckoutForm(page, { email });
  await page.getByRole("button", { name: "Place the order" }).click();
  await expect(line).toContainText("Cannot be ordered: Not enough stock available.");
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);

  // ... and a changed request gets a new one.
  await page.getByLabel("City", { exact: true }).fill("Lviv");
  await page.getByRole("button", { name: "Place the order" }).click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[2]).not.toBe(keys[0]);
  expect(await storedAttempt(page)).not.toBe(attempt);
});
