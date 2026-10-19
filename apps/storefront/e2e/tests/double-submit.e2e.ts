import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { fillCheckoutForm } from "../support/flows.ts";

test("a double click on the submit button places exactly one order", async ({
  page,
  shopper,
  admin,
}, testInfo) => {
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  const email = uniqueEmail(testInfo, "double");

  const keys: (string | undefined)[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/store/checkout")) keys.push(request.headers()["idempotency-key"]);
  });

  await page.goto("/en/checkout");
  await fillCheckoutForm(page, { email });
  await page.getByRole("button", { name: "Place the order" }).dblclick();
  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=/);

  // Whatever the timing was (a dropped second click, or two requests answered 201 and 200), the shop holds ONE order.
  expect(keys.length).toBeGreaterThanOrEqual(1);
  expect(new Set(keys).size, "every request of the double click carries the same key").toBe(1);
  expect(await admin.orderNumbersOf(email)).toHaveLength(1);
});
