import { randomUUID } from "node:crypto";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";

test("the language switcher keeps the page and the query string", async ({ page }) => {
  await page.goto("/uk/catalog?brand=demo-brand");
  await expect(page.locator("html")).toHaveAttribute("lang", "uk");
  // The server renders the links without the query; the browser adds it after hydration, so wait for the finished link.
  const english = page.getByRole("link", { name: "English" });
  await expect(english).toHaveAttribute("href", "/en/catalog?brand=demo-brand");
  await english.click();
  await expect(page).toHaveURL(/\/en\/catalog\?brand=demo-brand$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();

  await page.goto("/en/p/demo-hammer");
  await page.getByRole("link", { name: "Українська" }).click();
  await expect(page).toHaveURL(/\/uk\/p\/demo-hammer$/);
  await expect(page.getByRole("heading", { level: 1, name: "Демо молоток" })).toBeVisible();
});

test("the language switcher keeps the order link's fragment, in both directions", async ({
  page,
  shopper,
}, testInfo) => {
  // A guest order placed through the API in the browser's own session (the switcher is what is under test).
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  const order = await shopper.checkout({
    email: uniqueEmail(testInfo, "locale"),
    idempotencyKey: randomUUID(),
    shipping: true,
  });
  const token = order.accessToken ?? "";
  expect(token).not.toBe("");

  await page.goto(`/uk/order/${order.number}#t=${token}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Замовлення ${order.number}` }),
  ).toBeVisible();

  // The links are built in the browser after hydration: wait for the fragment to be in the link, then use it.
  const english = page.getByRole("link", { name: "English" });
  await expect(english).toHaveAttribute("href", `/en/order/${order.number}#t=${token}`);
  await english.click();
  await expect(page).toHaveURL(`/en/order/${order.number}#t=${token}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Order ${order.number}` }),
  ).toBeVisible();
  await expect(page.getByText("Awaiting payment", { exact: true })).toBeVisible();

  const ukrainian = page.getByRole("link", { name: "Українська" });
  await expect(ukrainian).toHaveAttribute("href", `/uk/order/${order.number}#t=${token}`);
  await ukrainian.click();
  await expect(page).toHaveURL(`/uk/order/${order.number}#t=${token}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Замовлення ${order.number}` }),
  ).toBeVisible();
});

test("the copy button falls back to a message when the Clipboard API is missing", async ({
  page,
  shopper,
}, testInfo) => {
  // `navigator.clipboard` does not exist on plain HTTP outside localhost; here it is removed before the page runs.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  const order = await shopper.checkout({
    email: uniqueEmail(testInfo, "clipboard"),
    idempotencyKey: randomUUID(),
    shipping: true,
  });
  await page.goto(`/en/order/${order.number}#t=${order.accessToken ?? ""}`);
  await page.getByRole("button", { name: "Copy the link" }).click();
  await expect(
    page.getByText("The link could not be copied. Select it in the field and copy it yourself."),
  ).toBeVisible();
  // The link stays readable and selectable in its field.
  await expect(page.getByLabel("Link to your order")).toHaveValue(/\/en\/order\/.+#t=.+/);
});
