import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { fillCheckoutForm } from "../support/flows.ts";

/**
 * How long the first checkout request is held back, so a second submit that the client does not refuse has time to leave
 * the browser. A fault window, not a synchronisation sleep: nothing waits for it to pass except the proof that no second
 * request came.
 */
const HOLD_FIRST_REQUEST_MS = 1_500;

test("a double click on the submit button sends ONE request and places exactly one order", async ({
  page,
  shopper,
  admin,
}, testInfo) => {
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  const email = uniqueEmail(testInfo, "double");

  // Every checkout request that leaves the browser. The first answer is slow: with the client's guards (the store's in-flight
  // promise, the form's `submitting` ref, the disabled button) the second click never becomes a request while it is pending.
  const keys: (string | undefined)[] = [];
  await page.route("**/store/checkout", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 1)
      await new Promise((resolve) => setTimeout(resolve, HOLD_FIRST_REQUEST_MS));
    await route.continue();
  });

  await page.goto("/en/checkout");
  await fillCheckoutForm(page, { email });
  const submit = page.getByRole("button", { name: "Place the order" });
  await submit.dblclick();
  // While the answer is pending the form is busy and the button cannot be used again.
  await expect(page.getByRole("button", { name: "Placing the order" })).toBeDisabled();
  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=/);

  expect(keys, "the second click must not become a second request").toHaveLength(1);
  expect(await admin.orderNumbersOf(email)).toHaveLength(1);
});
