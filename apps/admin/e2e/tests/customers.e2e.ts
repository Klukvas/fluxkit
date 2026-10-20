import { StoreApi } from "../support/api.ts";
import { SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";

test("customers: a locked customer is unlocked, deactivated (sessions end) and activated again", async ({
  page,
  signIn,
  shopper,
  apiContext,
}, testInfo) => {
  const u = unique(testInfo);
  const email = `e2e-customer-${u}@example.com`;
  const password = "customer-password-0123";
  await shopper.register(email, password);
  expect(await shopper.me(), "registered and signed in").toBe(200);

  // Five failed store sign-ins (from another address) lock the account; then even the right password is refused.
  const attacker = new StoreApi(await apiContext("attacker"));
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    expect(await attacker.login(email, `wrong password ${attempt}`)).toBe(401);
  }
  expect(await attacker.login(email, password), "locked").toBe(401);

  await signIn("manager");
  const main = page.getByRole("main");
  await page.goto(`${SPA}/customers`);
  await main.getByRole("searchbox", { name: "Email starts with" }).fill(`e2e-customer-${u}`);
  await main.getByRole("button", { name: "Search" }).click();
  const list = main.getByRole("table", { name: "Customers, ordered by email" });
  await expect(list.getByRole("row")).toHaveCount(2);
  await list.getByRole("link", { name: email }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Customer" })).toBeVisible();
  await expect(main).toContainText(email);
  await expect(main.getByText("This account is locked")).toBeVisible();

  // Unlock: one request, the lock is gone, the customer can sign in again.
  await main.getByRole("button", { name: "Unlock" }).click();
  await expect(
    main.getByText(
      "The lock is cleared. The customer can try to sign in again. The details are read again below.",
    ),
  ).toBeVisible();
  await expect(main.getByText("This account is locked")).toHaveCount(0);
  await expect(main.getByText("Not locked")).toBeVisible();
  expect(await attacker.login(email, password), "unlocked").toBe(200);

  // Deactivate (confirmed): every session ends at once and sign-in is refused.
  await main.getByRole("button", { name: "Deactivate", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Deactivate this customer?" });
  await expect(confirm.getByRole("button", { name: "Keep the customer active" })).toBeFocused();
  await confirm.getByRole("button", { name: "Deactivate the customer" }).click();
  await expect(
    main.getByText(
      "The customer is deactivated: all their sessions ended and sign-in is refused. The details are read again below.",
    ),
  ).toBeVisible();
  await expect(main.getByText("Deactivated", { exact: true }).first()).toBeVisible();
  expect(await shopper.me(), "the registration session ended").toBe(401);
  expect(await attacker.me(), "the later session ended too").toBe(401);
  expect(await attacker.login(email, password), "deactivated").toBe(401);

  // Activate: sign-in works again (the old sessions stay gone).
  await main.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(
    main.getByText(
      "The customer is active again and can sign in. The details are read again below.",
    ),
  ).toBeVisible();
  expect(await attacker.login(email, password), "active again").toBe(200);
  expect(await shopper.me()).toBe(401);
});
