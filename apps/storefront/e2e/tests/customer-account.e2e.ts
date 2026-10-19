import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { fillCheckoutForm, orderNumberOnPage, waitForHydration } from "../support/flows.ts";

const PASSWORD = "a long e2e password 123";

test("a shopper registers with a guest cart, checks out as a customer and finds the order in the account", async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "customer");

  // A digital product: the cart does not ship, so the checkout asks for no address.
  await page.goto("/en/p/demo-e-book");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("link", { name: /Cart.*1 item in the cart/ })).toBeVisible();

  await page.getByRole("link", { name: "Sign in" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  // Wait for the new page: a field filled while the old page is still there would be filled on the wrong form.
  await expect(page.getByRole("heading", { level: 1, name: "Create an account" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("First name", { exact: true }).fill("Olena");
  await page.getByLabel("Last name", { exact: true }).fill("Shevchenko");
  await page.getByRole("button", { name: "Create account" }).click();

  // Signed in; the guest cart came along (an empty account cart needs no merge notice).
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByRole("link", { name: "Account: Olena" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cart.*1 item in the cart/ })).toBeVisible();
  await expect(page.getByText("Your carts were merged")).toHaveCount(0);

  await page.getByRole("link", { name: /^Cart/ }).first().click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await expect(
    page.getByText("Nothing in your cart needs shipping, so no address is needed."),
  ).toBeVisible();
  await expect(page.getByLabel("City")).toHaveCount(0);
  // The contact fields are prefilled from the account, once.
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Olena");
  await fillCheckoutForm(page, {});
  await page.getByRole("button", { name: "Place the order" }).click();

  // A customer's order lives in the account: no token, no fragment.
  await expect(page).toHaveURL(/\/en\/account\/orders\/[^#?/]+$/);
  const number = await orderNumberOnPage(page);
  await expect(page.getByText("Awaiting payment", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cart.*0 items in the cart/ })).toBeVisible();

  // The history lists it, newest first, and the link opens the same order.
  await page.getByRole("link", { name: "Back to my orders" }).click();
  await expect(page).toHaveURL(/\/en\/account\/orders$/);
  const orders = page.getByRole("list", { name: "Your orders" });
  await expect(orders.getByRole("listitem")).toHaveCount(1);
  await expect(orders).toContainText("1 item");
  await expect(orders).toContainText("Awaiting payment");
  await orders.getByRole("link", { name: `Order ${number}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Order ${number}` })).toBeVisible();

  // Cancel it with the confirmation step; the history shows the new status.
  await page.getByRole("button", { name: "Cancel the order" }).click();
  await page.getByRole("button", { name: "Yes, cancel the order" }).click();
  await expect(page.getByText("The order is cancelled.")).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to my orders" }).click();
  await expect(page.getByRole("list", { name: "Your orders" })).toContainText("Cancelled");
});

test("signing in merges the guest cart into the account cart and shows the merge notice once", async ({
  page,
  otherShopper,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "merge");
  // The account already holds 600 screwdrivers in its cart (set up through the API in another session).
  const screwdriver = await otherShopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await otherShopper.register(email, PASSWORD);
  await otherShopper.addToCart(screwdriver.id, 600);
  await otherShopper.logout();

  // The browser, as a guest, puts 600 of the same product into its own cart.
  await page.goto("/en/p/demo-screwdriver");
  await waitForHydration(page);
  await page.getByLabel("Quantity", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to the cart.")).toBeVisible();

  await page.goto("/en/account/login");
  await waitForHydration(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account$/);

  // 600 + 600 is more than one line may hold: the quantity is capped and the shopper is told, once.
  const notice = page.getByText("Your carts were merged");
  await expect(notice).toHaveCount(1);
  await expect(
    page.getByText("Some quantities were reduced to the maximum for one item."),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);

  // Gone for good: not on the next page, not after a reload.
  await page.getByRole("link", { name: /^Cart/ }).first().click();
  await expect(page.getByRole("spinbutton", { name: "Quantity of Demo Screwdriver" })).toHaveValue(
    "999",
  );
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Quantity of Demo Screwdriver" })).toHaveValue(
    "999",
  );
  await expect(notice).toHaveCount(0);
});
