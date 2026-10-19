import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { orderNumberOnPage, tabTo, waitForHydration } from "../support/flows.ts";

test("the whole purchase works with the keyboard alone (Tab, Enter, Space and typing; no mouse)", async ({
  page,
}, testInfo) => {
  await page.goto("/en/p/demo-screwdriver");
  await waitForHydration(page);

  // Product page: reach "Add to cart" with Tab and press Enter.
  await tabTo(page, page.getByRole("button", { name: "Add to cart" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Added to the cart.")).toBeVisible();

  // The next control is the link to the cart.
  const toCart = page.getByRole("link", { name: "Go to the cart" });
  await page.keyboard.press("Tab");
  await expect(toCart).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Cart" })).toBeVisible();

  // Cart page: Tab to the checkout link, Enter.
  await expect(page.getByRole("list", { name: "Items in the cart" })).toContainText(
    "Demo Screwdriver",
  );
  await tabTo(page, page.getByRole("link", { name: "Checkout" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();

  // Checkout form: the focus order is the reading order, every field takes typed text, the select needs no action.
  const field = (label: string) => page.getByLabel(label, { exact: true });
  await tabTo(page, field("Email"));
  const steps: [string, string | null][] = [
    ["Email", uniqueEmail(testInfo, "keyboard")],
    ["Phone", "+380501234567"],
    ["First name", "Olena"],
    ["Last name", "Shevchenko"],
    ["Country", null],
    ["Region (optional)", null],
    ["City", "Kyiv"],
    ["Postal code (optional)", null],
    ["Street and house number", "1 Example Street"],
    ["Apartment, floor, entrance (optional)", null],
  ];
  for (const [index, [label, text]] of steps.entries()) {
    if (index > 0) await page.keyboard.press("Tab");
    await expect(field(label), `Tab reaches "${label}" in reading order`).toBeFocused();
    if (text !== null) await page.keyboard.type(text);
  }
  await page.keyboard.press("Tab");
  const submit = page.getByRole("button", { name: "Place the order" });
  await expect(submit).toBeFocused();
  await page.keyboard.press("Space");

  // The order page, and the cancel with its confirmation, also by keyboard. Focus must follow the shopper: the button that
  // was pressed disappears, and a keyboard user must not be dropped back at the top of the page.
  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=/);
  await orderNumberOnPage(page);
  const ask = page.getByRole("button", { name: "Cancel the order" });
  const keep = page.getByRole("button", { name: "Keep the order" });
  await tabTo(page, ask);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Cancel this order? This cannot be undone.")).toBeVisible();
  await expect(keep, "after asking, the focus is on the safe answer").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ask, "after keeping the order, the focus is back on the ask button").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(keep).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Yes, cancel the order" }));
  await page.keyboard.press("Space");
  const done = page.getByText("The order is cancelled.");
  await expect(done).toBeVisible();
  await expect(done, "after cancelling, the focus is on the message").toBeFocused();
});
