import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

test("a failed sign-in shows one message, marks no field and moves the focus to it", async ({
  page,
}, testInfo) => {
  await page.goto("/en/account/login");
  await waitForHydration(page);
  await page.getByLabel("Email", { exact: true }).fill(uniqueEmail(testInfo, "nobody"));
  await page.getByLabel("Password", { exact: true }).fill("not the right password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  const message = page.getByText("The email or password is not correct.");
  await expect(message).toHaveCount(1);
  // (Next's route announcer is an empty `role="alert"` too: only alerts with text count.)
  const alerts = page.getByRole("alert").filter({ hasText: /\S/ });
  await expect(alerts).toHaveCount(1);
  // The API does not say which of the two was wrong, so neither field may look wrong.
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  // Focus goes to the error summary (no field is to blame), so a screen reader reads the message.
  await expect(page.locator('div[tabindex="-1"]').filter({ has: message })).toBeFocused();
  // The password is cleared, the email stays, and the form is usable again: a second failure still shows ONE message.
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(/@example\.com$/);
  await page.getByLabel("Password", { exact: true }).fill("still not the right password");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(message).toHaveCount(1);
  await expect(alerts).toHaveCount(1);
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/en\/account\/login$/);
});
