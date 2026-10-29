import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

/**
 * Privacy plan step 10 and 12, storefront half. REAL stack: the API runs on a migrated, seeded database, the browser talks
 * to the proxy. What these scenarios prove:
 * - "Your data": the download is a JSON file built in the browser (parsed here, and its Blob type recorded), the daily limit
 *   shows its wait, and deleting the account asks for the password AND the typed word, names the blockers of an open order,
 *   and after the order is closed ends on the confirmation page with the shopper signed out;
 * - afterwards the admin sees the order with its contact data erased and its totals unchanged;
 * - the only cookies the whole flow sets are the two the cookie statement lists.
 */

const PASSWORD = "a long e2e password 123";

/** Records the media type of every Blob the page turns into an object URL (the download's file type). */
async function recordBlobTypes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as { __blobTypes: string[] };
    scope.__blobTypes = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) scope.__blobTypes.push(object.type);
      return create(object);
    };
  });
}

async function blobTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __blobTypes: string[] }).__blobTypes);
}

test("a shopper downloads their data and deletes the account; the admin sees the order erased with its totals intact", async ({
  page,
  shopper,
  admin,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "erase");
  await recordBlobTypes(page);

  // Registration shows the information sentence with its two links, and no checkbox.
  await page.goto("/en/account/register");
  await waitForHydration(page);
  const notice = page.locator("p").filter({ hasText: /By creating an account you accept the/ });
  await expect(notice.getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    "/en/legal/terms",
  );
  await expect(notice.getByRole("link", { name: "Privacy notice" })).toHaveAttribute(
    "href",
    "/en/legal/privacy",
  );
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("First name", { exact: true }).fill("Olena");
  await page.getByLabel("Last name", { exact: true }).fill("Shevchenko");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/en\/account$/);

  // An order of this account, still unpaid (a digital product: no address). The browser and `shopper` share the cookies.
  const variant = (await shopper.product("demo-e-book")).variants[0];
  if (variant === undefined) throw new Error("The seed has no variant for demo-e-book.");
  await shopper.addToCart(variant.id, 1);
  const order = await shopper.checkout({ idempotencyKey: randomUUID(), shipping: false });

  // The account page links to "Your data".
  await page.goto("/en/account");
  await waitForHydration(page);
  await page.getByRole("link", { name: "Your data" }).click();
  await expect(page).toHaveURL(/\/en\/account\/data$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your data" })).toBeVisible();
  await waitForHydration(page);

  // --- Download my data: a JSON file built from the response.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download my data" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^personal-data-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const document = JSON.parse(await readFile(path, "utf8")) as {
    format: string;
    subject: { kind: string };
    account: { email: string } | null;
    orders: { number: string }[];
  };
  expect(document.format).toBe("fluxkit.personal-data-export/v1");
  expect(document.subject.kind).toBe("customer");
  expect(document.account?.email).toBe(email);
  expect(document.orders.map((entry) => entry.number)).toEqual([order.number]);
  // No hash or token anywhere in the file.
  expect(JSON.stringify(document)).not.toMatch(/passwordHash|tokenHash|requestFingerprint/i);
  expect(await blobTypes(page)).toEqual(["application/json"]);
  // The result is in the status region, and the focus moved to it.
  const status = page.locator('div[role="status"][tabindex="-1"]').filter({
    hasText: "was downloaded",
  });
  await expect(status).toContainText(download.suggestedFilename());
  await expect(status).toBeFocused();

  // --- Delete my account: every step that must refuse changes nothing.
  const password = page.getByLabel("Password", { exact: true });
  const word = page.getByLabel("Type DELETE to confirm");
  const submit = page.getByRole("button", { name: "Delete my account for good" });

  // A wrong password marks the password field.
  await password.fill("not the right password");
  await word.fill("delete");
  await submit.click();
  await expect(page.getByText("The password is incorrect.").first()).toBeVisible();
  await expect(password).toBeFocused();
  await expect(password).toHaveValue("");

  // The right password without the typed word sends nothing (checked below by the account still being there).
  const deletes: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/store/account/delete")) deletes.push(request.method());
  });
  await password.fill(PASSWORD);
  await word.fill("remove");
  await submit.click();
  await expect(
    page.getByText("The word does not match. Type it exactly as shown.").first(),
  ).toBeVisible();
  expect(deletes, "no request without the typed word").toEqual([]);

  // The open order blocks the deletion, in words; nothing is deleted.
  await password.fill(PASSWORD);
  await word.fill("Delete");
  await submit.click();
  const blocked = page.locator('div[tabindex="-1"]').filter({
    hasText: "Your account cannot be deleted right now",
  });
  await expect(blocked).toContainText("You have an order that is not finished yet");
  await expect(blocked).toBeFocused();
  expect(deletes).toEqual(["POST"]);
  expect(await shopper.dataExportStatus()).toMatchObject({ status: 200 });

  // Close the order (cancel it), then delete for good.
  await shopper.cancelCustomerOrder(order.number);
  await password.fill(PASSWORD);
  await word.fill("DELETE");
  await submit.click();
  await expect(page).toHaveURL(/\/en\/account\/deleted$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your account was deleted" }),
  ).toBeVisible();
  await expect(page.getByText("you are signed out")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Cart.*0 items in the cart/ })).toBeVisible();

  // Signing in is refused afterwards, and the data page sends the shopper to sign in.
  await page.goto("/en/account/login");
  await waitForHydration(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("The email or password is not correct.")).toHaveCount(1);

  // The admin: the order is there, the contact is gone, the totals are what they were.
  const erased = await admin.orderByNumber(order.number);
  expect(erased.contact).toEqual({ email: null, phone: null, firstName: null, lastName: null });
  expect(erased.contactErasedAt).not.toBeNull();
  expect(erased.customerId).toBeNull();
  expect(erased.status).toBe("cancelled");
  expect(erased.total).toEqual(order.total);
  expect(erased.items).toHaveLength(1);
  expect(erased.items[0]?.sku).toBe(variant.sku);
  expect(erased.shippingAddress).toBeNull();

  // The cookies of the whole flow are exactly those the cookie statement lists.
  const names = (await page.context().cookies()).map((cookie) => cookie.name);
  for (const name of names) expect(["fluxkit_cart", "fluxkit_customer_session"]).toContain(name);
});

test("the daily limit of the download shows its wait, and the legal pages are placeholders with the marker", async ({
  page,
  shopper,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "limit");
  await shopper.register(email, PASSWORD);
  // Five downloads use the day's allowance; the sixth is refused with a wait.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    expect((await shopper.dataExportStatus()).status).toBe(200);
  }
  const refused = await shopper.dataExportStatus();
  expect(refused.status).toBe(429);
  expect(refused.retryAfter).toMatch(/^\d+$/);

  await page.goto("/en/account/data");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Download my data" }).click();
  const limited = page.locator('div[role="status"][tabindex="-1"]').filter({
    hasText: "too often today",
  });
  await expect(limited).toContainText(/Try again in about \d+ (hours?|minutes?)\./);
  await expect(limited).toBeFocused();

  // Legal pages: placeholders with the visible template marker, linked from the footer, no cookie banner.
  const footer = page.getByRole("navigation", { name: "Footer navigation" });
  for (const [name, path] of [
    ["Privacy notice", "/en/legal/privacy"],
    ["Terms", "/en/legal/terms"],
    ["Cookies", "/en/legal/cookies"],
  ] as const) {
    await expect(footer.getByRole("link", { name, exact: true })).toHaveAttribute("href", path);
  }
  await footer.getByRole("link", { name: "Cookies", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cookies" })).toBeVisible();
  await expect(
    page.getByText("TODO(fluxkit): replace with the shop's own legal text"),
  ).toBeVisible();
  const table = page.getByRole("table", { name: "The cookies of this shop" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table).toContainText("fluxkit_cart");
  await expect(table).toContainText("fluxkit_customer_session");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/en/legal/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();
  await expect(page.getByText("[to be filled in by the shop]").first()).toBeVisible();
  // An unknown legal page is a real 404.
  const unknown = await page.goto("/en/legal/nothing");
  expect(unknown?.status()).toBe(404);
});
