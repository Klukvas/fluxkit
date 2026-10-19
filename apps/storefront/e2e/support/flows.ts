import { expect, type Locator, type Page } from "@playwright/test";

/** The checkout form's contact fields and, for a cart that ships, the address (labels of `messages/en.json`). */
export interface CheckoutDetails {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  line1?: string;
}

export const DEFAULT_DETAILS = {
  phone: "+380501234567",
  firstName: "Olena",
  lastName: "Shevchenko",
  city: "Kyiv",
  line1: "1 Example Street",
} as const;

/** Fills the checkout form by its labels. Skips the address fields when the form shows none (a digital-only cart). */
export async function fillCheckoutForm(page: Page, details: CheckoutDetails): Promise<void> {
  const merged = { ...DEFAULT_DETAILS, ...details };
  if (details.email !== undefined)
    await page.getByLabel("Email", { exact: true }).fill(details.email);
  const phone = page.getByLabel("Phone", { exact: true });
  if ((await phone.inputValue()) === "") await phone.fill(merged.phone);
  const first = page.getByLabel("First name", { exact: true });
  if ((await first.inputValue()) === "") await first.fill(merged.firstName);
  const last = page.getByLabel("Last name", { exact: true });
  if ((await last.inputValue()) === "") await last.fill(merged.lastName);
  const city = page.getByLabel("City", { exact: true });
  if ((await city.count()) > 0) {
    await city.fill(merged.city);
    await page.getByLabel("Street and house number", { exact: true }).fill(merged.line1);
  }
}

/** Chooses one value of each named option on a product page (the radios are visually hidden: click the visible label). */
export async function chooseOptions(page: Page, choices: Record<string, string>): Promise<void> {
  for (const [option, value] of Object.entries(choices)) {
    await page
      .getByRole("group", { name: option, exact: true })
      .getByText(value, { exact: true })
      .click();
  }
}

/** The fragment after `#t=` of the current address: the guest order's access token. */
export function tokenOf(url: string): string {
  const match = /#t=([A-Za-z0-9_-]+)$/.exec(url);
  if (match === null) throw new Error(`No order token in the fragment of ${url}`);
  return match[1] as string;
}

/** The order number the order page shows in its heading. */
export async function orderNumberOnPage(page: Page): Promise<string> {
  const heading = page.getByRole("heading", { level: 1, name: /^Order / });
  await expect(heading).toBeVisible();
  return ((await heading.textContent()) ?? "").replace(/^Order\s+/, "").trim();
}

/** Presses Tab until `target` has the focus, and returns the ids of what was focused on the way (never uses the mouse). */
export async function tabTo(page: Page, target: Locator, limit = 80): Promise<string[]> {
  const path: string[] = [];
  for (let step = 0; step < limit; step += 1) {
    const focused = await target.evaluate((element) => element === document.activeElement);
    if (focused) return path;
    await page.keyboard.press("Tab");
    path.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        return element === null
          ? "(none)"
          : element.id ||
              element.getAttribute("aria-label") ||
              element.textContent?.trim().slice(0, 30) ||
              element.tagName;
      }),
    );
  }
  throw new Error(
    `Tab never reached the target within ${String(limit)} presses; passed: ${path.join(" > ")}`,
  );
}
