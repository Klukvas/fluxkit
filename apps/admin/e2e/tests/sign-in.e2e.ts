import { CREDENTIALS, expect, test, unique } from "../support/fixtures.ts";
import { SPA } from "../support/env.ts";

const FAILED =
  "The email or password is not correct, or the account is temporarily locked. If you cannot sign in, ask a shop owner.";

test("a failed sign-in shows one message and clears the password", async ({ page }) => {
  await page.goto(`${SPA}/login`);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to the admin" })).toBeVisible();
  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  await email.fill(CREDENTIALS.owner.email);
  await password.fill("not the right password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  const message = page.getByText(FAILED, { exact: true });
  await expect(message).toHaveCount(1);
  // The password is cleared and gets the focus for the next try; the email stays.
  await expect(password).toHaveValue("");
  await expect(password).toBeFocused();
  await expect(email).toHaveValue(CREDENTIALS.owner.email);
  // An unknown email gives exactly the same message (the API's single 401).
  await email.fill("nobody-at-all@example.com");
  await password.fill("still not the right password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(message).toHaveCount(1);
  await expect(password).toHaveValue("");
  await expect(page).toHaveURL(new RegExp(`${SPA}/login`));
  expect((await page.request.get("/admin/auth/me")).status(), "no session after failures").toBe(
    401,
  );
});

test("a locked-out admin sees the same generic message, also with the right password", async ({
  page,
  owner,
}, testInfo) => {
  const email = `e2e-locked-${unique(testInfo)}@example.com`;
  const rightPassword = "locked-admin-password-0123";
  await owner.createUser(email, "viewer", rightPassword);

  await page.goto(`${SPA}/login`);
  const message = page.getByText(FAILED, { exact: true });
  // Five failures lock the account for 15 minutes (ADR 0010).
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(`wrong password number ${attempt}`);
    const answer = page.waitForResponse("**/admin/auth/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    expect((await answer).status()).toBe(401);
    await expect(message).toHaveCount(1);
  }
  // Now the right password: still the identical message, no word about a lock, and no session.
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(rightPassword);
  const answer = page.waitForResponse("**/admin/auth/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await answer).status()).toBe(401);
  await expect(message).toHaveCount(1);
  await expect(page.getByText(/lock/i)).toHaveCount(1); // only the generic sentence itself mentions "locked"
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("sign in with the form, land on the requested page, sign out", async ({ page }) => {
  // A deep link without a session goes to sign-in and comes back after it.
  await page.goto(`${SPA}/orders`);
  await expect(page).toHaveURL(new RegExp(`${SPA}/login\\?next=`));
  await page.getByLabel("Email", { exact: true }).fill(CREDENTIALS.manager.email);
  await page.getByLabel("Password", { exact: true }).fill(CREDENTIALS.manager.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/orders$`));
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${CREDENTIALS.manager.email}`)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to the admin" })).toBeVisible();
  expect((await page.request.get("/admin/auth/me")).status(), "the session is gone").toBe(401);
  // Back to a protected page: sign-in again, nothing of the old session is shown.
  await page.goto(`${SPA}/orders`);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to the admin" })).toBeVisible();
  await expect(page.getByText(CREDENTIALS.manager.email)).toHaveCount(0);
});

test("the language switch shows Ukrainian, sets the document language and is remembered", async ({
  page,
}) => {
  await page.goto(`${SPA}/login`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Українська" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Вхід до адмінки" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "uk");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Вхід до адмінки" })).toBeVisible();
  // A failed sign-in in Ukrainian: the same single generic message, translated.
  await page.getByLabel("Електронна пошта", { exact: true }).fill(CREDENTIALS.viewer.email);
  await page.getByLabel("Пароль", { exact: true }).fill("not the right password");
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  await expect(
    page.getByText(
      "Неправильна пошта чи пароль, або обліковий запис тимчасово заблоковано. Якщо не вдається увійти, зверніться до власника магазину.",
      { exact: true },
    ),
  ).toHaveCount(1);
});
