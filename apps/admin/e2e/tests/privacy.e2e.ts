import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { AdminApi } from "../support/api.ts";
import { MANAGER_EMAIL, MANAGER_PASSWORD, SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";

/**
 * Privacy plan steps 9 and 12, admin half. REAL stack: the owner works in the browser on a migrated, seeded database; guest
 * orders are set up through the store API (what the scenario is NOT about). What these scenarios prove:
 * - the owner finds a guest by email (the address is typed into a POST form, never in an address), records a request,
 *   downloads the export as a JSON file (parsed here, with the Blob type recorded), sees the blockers of an open order in
 *   words, and erases a closed order only through the dialog and its typed word;
 * - the erased order shows its label on the order page, with its totals intact;
 * - the audit log lists the actions, with filters and "load older events";
 * - a manager has no Personal data and no Audit log: no navigation entry, "Not allowed" on the direct address, 403 from the API.
 */

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

/** Looks the address up and records a request of `kind` for it, then opens the request. */
async function recordRequest(
  page: Page,
  email: string,
  kind: "Export of personal data" | "Erasure of personal data",
  note: string,
): Promise<void> {
  const main = page.getByRole("main");
  await page.goto(`${SPA}/privacy/lookup`);
  await expect(main.getByRole("heading", { level: 1, name: "Look up by email" })).toBeVisible();
  await main.getByLabel("Email address").fill(email);
  await main.getByRole("button", { name: "Look up" }).click();
  await expect(main.getByText("Lookup finished. The result is below.")).toBeVisible();
  await main.getByLabel("Request", { exact: true }).selectOption({ label: kind });
  await main.getByLabel("How the identity was checked").fill(note);
  await main.getByRole("button", { name: "Record the request" }).click();
  await expect(main.getByText("The request was recorded.")).toBeVisible();
  await main.getByRole("link", { name: "Open the request" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Privacy request" })).toBeVisible();
}

test("privacy: the owner exports a guest's data, sees what blocks an open order and erases a closed one", async ({
  page,
  signIn,
  shopper,
  owner,
  guard,
}, testInfo) => {
  const u = unique(testInfo);
  const openEmail = `e2e-privacy-open-${u}@example.com`;
  const closedEmail = `e2e-privacy-closed-${u}@example.com`;
  // Setup: one guest with an unpaid order, one with a fulfilled order.
  const placedOpen = await shopper.placeGuestOrder(
    openEmail,
    "demo-screwdriver",
    "DEMO-SCREWDRIVER",
  );
  const placedClosed = await shopper.placeGuestOrder(
    closedEmail,
    "demo-screwdriver",
    "DEMO-SCREWDRIVER",
  );
  // The store's answer has the number only: the admin API knows the id.
  const open = { ...placedOpen, id: await owner.orderIdByNumber(placedOpen.number) };
  const closed = { ...placedClosed, id: await owner.orderIdByNumber(placedClosed.number) };
  await owner.markPaid(closed.id, `e2e-privacy-${u}`, closed.total);
  await owner.post(`/admin/orders/${closed.id}/mark-fulfilled`, undefined, 200);

  await recordBlobTypes(page);
  await signIn("owner");
  const main = page.getByRole("main");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await nav.getByRole("link", { name: "Personal data" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Personal data" })).toBeVisible();
  await expect(main.getByText("No requests yet").or(main.getByRole("table"))).toBeVisible();

  // --- Look up the open guest, record an export, download it.
  await recordRequest(page, openEmail, "Export of personal data", "replied from the address");
  await expect(main.getByText("replied from the address", { exact: true })).toBeVisible();
  await main.getByLabel("The person's email address").fill(openEmail);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    main.getByRole("button", { name: "Download the personal data" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^personal-data-\d{4}-\d{2}-\d{2}\.json$/);
  const document = JSON.parse(await readFile(await download.path(), "utf8")) as {
    format: string;
    subject: { kind: string };
    account: unknown;
    orders: { number: string }[];
  };
  expect(document.format).toBe("fluxkit.personal-data-export/v1");
  expect(document.subject.kind).toBe("email");
  expect(document.account).toBeNull();
  expect(document.orders.map((entry) => entry.number)).toEqual([open.number]);
  expect(JSON.stringify(document)).not.toMatch(/accessTokenHash|requestFingerprint|passwordHash/i);
  expect(await blobTypes(page)).toEqual(["application/json"]);
  await expect(main.getByText(/was downloaded: 1 order, 0 mails, 0 sessions\./)).toBeVisible();
  await expect(main.getByText("Completed", { exact: true }).first()).toBeVisible();

  // --- An erasure request for the open guest: the preview names the blocker, erasing is not offered.
  await recordRequest(page, openEmail, "Erasure of personal data", "replied from the address");
  await main.getByLabel("The person's email address").fill(openEmail);
  const erase = main.getByRole("button", { name: "Erase..." });
  await expect(erase).toBeDisabled();
  await main.getByRole("button", { name: "Preview the erasure" }).click();
  await expect(main.getByText("Erasure is blocked", { exact: true })).toBeVisible();
  await expect(
    main.getByText(`Order ${open.number}: the order is still open`, { exact: false }),
  ).toBeVisible();
  await expect(erase).toBeDisabled();
  // Even a forced call is refused by the API, with the reasons, and nothing changes.
  const forced = await owner.post<{ reasons?: string[] }>(
    `/admin/privacy/requests/${page.url().split("/").pop()}/erase`,
    { email: openEmail, confirm: true },
    409,
  );
  expect(forced.reasons).toEqual(["open_order"]);
  expect(await owner.orderStatus(open.id)).toBe("awaiting_payment");

  // --- The closed guest: preview, then the dialog. The typed word is required; without it nothing is sent.
  await recordRequest(page, closedEmail, "Erasure of personal data", "replied from the address");
  const closedRequestId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(closedRequestId).toMatch(/^[0-9a-f-]{36}$/);
  await main.getByLabel("The person's email address").fill(closedEmail);
  await main.getByRole("button", { name: "Preview the erasure" }).click();
  await expect(main.getByText("Nothing is in the way. You can erase now.")).toBeVisible();
  await expect(erase).toBeEnabled();
  const eraseCalls = () =>
    guard.requests.filter(
      (request) =>
        request.method === "POST" && /\/privacy\/requests\/[^/]+\/erase$/.test(request.url),
    );

  await erase.click();
  const dialog = page.getByRole("alertdialog", { name: "Erase the personal data" });
  await expect(dialog.getByRole("button", { name: "Keep the data" })).toBeFocused();
  await expect(dialog).toContainText("This cannot be undone");
  await expect(dialog).toContainText(
    "Order numbers, lines, totals, dates, payments, refunds and shipments stay",
  );
  await dialog.getByRole("button", { name: "Erase for good" }).click();
  await expect(
    dialog.getByText("The word does not match. Type it exactly as shown."),
  ).toBeVisible();
  await dialog.getByLabel("Type ERASE to confirm").fill("remove");
  await dialog.getByRole("button", { name: "Erase for good" }).click();
  await expect(
    dialog.getByText("The word does not match. Type it exactly as shown."),
  ).toBeVisible();
  expect(eraseCalls(), "no erase request without the typed word").toHaveLength(0);

  // Escape closes the dialog and keeps the data.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(eraseCalls()).toHaveLength(0);
  await erase.click();
  await dialog.getByLabel("Type ERASE to confirm").fill("erase");
  await dialog.getByRole("button", { name: "Erase for good" }).click();
  await expect(main.getByText("The erasure is done and cannot be undone.")).toBeVisible();
  await expect(
    main.getByText("The contact data of 1 order was erased. 0 stored mails were deleted."),
  ).toBeVisible();
  await expect(main.getByText("There was no account to delete.")).toBeVisible();
  await expect(main.getByText("Completed", { exact: true }).first()).toBeVisible();
  expect(eraseCalls()).toHaveLength(1);
  // The request is closed: no more actions.
  await expect(main.getByRole("button", { name: "Erase..." })).toHaveCount(0);

  // --- The erased order: labelled on its page, totals intact; the open order untouched.
  await page.goto(`${SPA}/orders/${closed.id}`);
  await expect(
    main.getByRole("heading", { level: 1, name: `Order ${closed.number}` }),
  ).toBeVisible();
  await expect(main.getByText(/The contact data of this order .* was erased on/)).toBeVisible();
  await expect(main.getByText("Erased", { exact: true })).toHaveCount(4);
  await expect(main).not.toContainText(closedEmail);
  const erasedOrder = await owner.get<{
    contact: Record<string, unknown>;
    contactErasedAt: string | null;
    total: { amount: number };
  }>(`/admin/orders/${closed.id}`);
  expect(erasedOrder.contactErasedAt).not.toBeNull();
  expect(erasedOrder.contact).toEqual({
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
  });
  expect(erasedOrder.total).toEqual(closed.total);
  await page.goto(`${SPA}/orders`);
  await expect(main.getByText("Contact data erased").first()).toBeVisible();
  await expect(main.getByText(openEmail)).toBeVisible();

  // --- The audit log lists the actions, newest first, and filters by action and by what an event concerns.
  await nav.getByRole("link", { name: "Audit log" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  const log = main.getByRole("table", { name: "Audit log" });
  await expect(log.getByRole("row", { name: /Privacy lookup by email/ }).first()).toBeVisible();
  await expect(log.getByRole("row", { name: /Personal data exported/ }).first()).toBeVisible();
  await expect(log.getByRole("row", { name: /Personal data erased/ }).first()).toBeVisible();
  // The log is shared by every test of the run (and by a retry), so the scenario filters down to ITS erasure: the answer is
  // known exactly (one event), which is what proves the filtered list is shown. The address changes before the list does,
  // so reading "the first rows" right after the URL could read the unfiltered list that is about to be replaced.
  await main.getByLabel("Action", { exact: true }).selectOption({ label: "Personal data erased" });
  await main.getByLabel("Id of what it concerns", { exact: true }).fill(closedRequestId);
  await main.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/audit\\?action=privacy\\.erased&targetId=${closedRequestId}$`),
  );
  // One filter form: the form of the previous filters is replaced, not left in the page next to the new one.
  await expect(main.getByRole("form", { name: "Filter the audit log" })).toHaveCount(1);
  const rows = log.getByRole("row");
  await expect(rows).toHaveCount(2);
  await expect(main.getByText("Showing 1 of 1.", { exact: true })).toBeVisible();
  await expect(rows.nth(1)).toContainText("Personal data erased");
  await expect(rows.nth(1).getByRole("link", { name: /^Privacy request / })).toHaveAttribute(
    "href",
    `/admin-ui/privacy/requests/${closedRequestId}`,
  );
  for (const row of await rows.all()) {
    const text = (await row.textContent()) ?? "";
    expect(text).not.toMatch(/Privacy lookup|Personal data exported/);
    // The log holds codes and ids only: no address of anyone.
    expect(text).not.toContain(closedEmail);
    expect(text).not.toContain(openEmail);
  }

  // No address of the people in any URL the browser asked for.
  for (const request of guard.requests) {
    expect(decodeURIComponent(request.url)).not.toContain(openEmail);
    expect(decodeURIComponent(request.url)).not.toContain(closedEmail);
  }
});

test("privacy: the audit log loads older events on request", async ({
  page,
  signIn,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  // 52 audited lookups (each an event): more than the 50 of the first page.
  for (let index = 0; index < 52; index += 1) {
    await owner.post(
      "/admin/privacy/lookup",
      { email: `e2e-audit-${u}-${String(index)}@example.com` },
      200,
    );
  }
  await signIn("owner");
  await page.goto(`${SPA}/audit`);
  const main = page.getByRole("main");
  const log = main.getByRole("table", { name: "Audit log" });
  await expect(log.getByRole("row")).toHaveCount(51);
  await expect(main.getByText(/^Showing 50 of \d+\.$/)).toBeVisible();
  await main.getByRole("button", { name: "Load older events" }).click();
  await expect(log.getByRole("row")).not.toHaveCount(51);
  const total = Number(
    /of (\d+)\./.exec((await main.getByText(/^Showing \d+ of \d+\.$/).textContent()) ?? "")?.[1],
  );
  expect(total).toBeGreaterThan(50);
  expect(await log.getByRole("row").count()).toBe(Math.min(total, 100) + 1);
});

test("privacy: a manager has no Personal data and no Audit log, and the API refuses with 403", async ({
  page,
  signIn,
  apiContext,
  guard,
}) => {
  await signIn("manager");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Personal data" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  for (const path of [
    "/privacy",
    "/privacy/lookup",
    "/privacy/requests/0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f",
    "/audit",
  ]) {
    await page.goto(`${SPA}${path}`);
    await expect(page.getByRole("heading", { level: 1, name: "Not allowed" })).toBeVisible();
  }
  const reads = guard.requests.filter((request) =>
    /^\/admin\/(privacy|audit-events)/.test(new URL(request.url).pathname),
  );
  expect(reads, "the manager's pages ask for no personal data").toEqual([]);

  const manager = await AdminApi.signIn(
    await apiContext("manager-api"),
    MANAGER_EMAIL,
    MANAGER_PASSWORD,
  );
  await manager.post("/admin/privacy/lookup", { email: "someone@example.com" }, 403);
  await manager.get("/admin/privacy/requests", 403);
  await manager.get("/admin/audit-events", 403);
});
