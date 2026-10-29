import type { Page, Request } from "@playwright/test";
import { SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";
import { seedSucceededPayment } from "../support/payments-db.ts";

/**
 * The admin payment screens (payments plan step 10): the payment panel of the order detail, the refund dialogs, check status,
 * closing an attention item, and the attention list. The API of this suite runs with NO payment provider
 * (`PAYMENT_PROVIDERS_ENABLED=""`) and the test-only fake provider cannot be driven across processes, so the rows a paying
 * shopper would have made are inserted into the database (`support/payments-db.ts`). What is real here: the SPA, the admin
 * routes and their permission checks, the database rules. What is NOT covered: a refund that a provider accepts (no provider
 * is loaded, so a refund is recorded and never delivered), a provider answer to Check status, and `unknown` or `processing`
 * refund outcomes; those are covered by the unit and component specs of the area and the API's integration tests.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The money text of the Intl formatter (a no-break space after the currency): the scenarios match the digits. */
const FULL = /189\.00/;

function watch(page: Page, pattern: RegExp): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (pattern.test(request.url())) seen.push(request);
  });
  return seen;
}

test("payments: the panel of an order without an online payment says so", async ({
  page,
  signIn,
  shopper,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const placed = await shopper.placeGuestOrder(
    `e2e-nopay-${u}@example.com`,
    "demo-screwdriver",
    "DEMO-SCREWDRIVER",
  );
  const orderId = await owner.orderIdByNumber(placed.number);
  await signIn("manager");
  await page.goto(`${SPA}/orders/${orderId}`);
  const panel = page.getByRole("main").getByRole("region", { name: "Online payment" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("No online payment was started for this order.");
  await expect(panel.getByRole("button")).toHaveCount(0);
});

test("payments: the panel, a refund dialog with a confirmation, one key per request, and the explained refusals", async ({
  page,
  signIn,
  shopper,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const placed = await shopper.placeGuestOrder(
    `e2e-refund-${u}@example.com`,
    "demo-screwdriver",
    "DEMO-SCREWDRIVER",
  );
  const orderId = await owner.orderIdByNumber(placed.number);
  await owner.markPaid(orderId, `FAKE-${u}`, placed.total);
  const paymentId = await seedSucceededPayment({
    orderId: orderId,
    providerPaymentId: `e2e-${u}`,
    amount: placed.total.amount,
  });

  await signIn("manager");
  await page.goto(`${SPA}/orders/${orderId}`);
  const main = page.getByRole("main");
  const panel = main.getByRole("region", { name: "Online payment" });

  // The attempt: status, amount, provider, the card as system and last four digits only, the journal.
  const card = panel.getByRole("article");
  await expect(card.getByRole("heading", { level: 3 })).toContainText("Payment of");
  await expect(card).toContainText("Paid");
  await expect(card).toContainText(FULL);
  await expect(card).toContainText("visa ending 4242");
  await expect(card).toContainText("The order was marked paid");
  await expect(card.getByRole("table", { name: "Refunds of this payment" })).toContainText(
    "No refunds yet.",
  );
  await card.getByText("Journal (1)").click();
  await expect(card.getByRole("table", { name: "Journal of this payment" })).toContainText(
    "From Processing to Paid",
  );
  await expect(card).not.toContainText(`e2e-${u}`);

  // Check status: no provider is enabled in this suite, which the API says and the screen explains.
  const resyncs = watch(page, /\/payments\/[^/]+\/resync$/);
  await card.getByRole("button", { name: "Check status" }).click();
  await expect(
    panel.getByText("This payment's provider is not enabled in this shop", { exact: false }),
  ).toBeVisible();
  expect(resyncs).toHaveLength(1);
  expect(resyncs[0]?.method()).toBe("POST");

  // The refund dialog starts at everything that is left.
  const refunds = watch(page, /\/payments\/[^/]+\/refunds$/);
  await card.getByRole("button", { name: "Refund" }).click();
  const form = page.getByRole("dialog", { name: `Refund order ${placed.number}` });
  const amount = form.getByRole("textbox", { name: /Amount to refund \(UAH\)/ });
  await expect(amount).toHaveValue("189.00");
  await expect(form.getByRole("textbox", { name: /Reason/ })).toHaveValue("");

  // Local checks first: an amount above what is left and a missing reason are refused on their fields, nothing is sent.
  await amount.fill("189.01");
  await form.getByRole("button", { name: "Review refund" }).click();
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByText(/At most .*189\.00 can still be refunded\./)).toBeVisible();
  await expect(form.getByText("Give a reason.")).toBeVisible();
  await amount.fill("1.234");
  await form.getByRole("button", { name: "Review refund" }).click();
  await expect(form.getByText("This currency has at most 2 decimals.")).toBeVisible();
  expect(refunds).toHaveLength(0);

  // A partial amount passes the local checks, reaches the confirmation step and sends nothing yet.
  await amount.fill("50.50");
  await form.getByRole("textbox", { name: /Reason/ }).fill("Damaged in transit");
  await form.getByRole("button", { name: "Review refund" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Refund order ${placed.number}` });
  await expect(confirm).toContainText("This cannot be undone");
  await expect(confirm).toContainText(/50\.50/);
  await expect(confirm).toContainText("Damaged in transit");
  // The focus moves to the warning (it is read first); the next Tab reaches Back, the safe choice, before Refund.
  await expect(confirm.locator('[tabindex="-1"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "Back" })).toBeFocused();
  expect(refunds).toHaveLength(0);

  // Back keeps what was typed; forward again, then confirm: the provider does not take partial refunds, which is explained
  // in the dialog (nothing was changed) and the dialog stays open on the form.
  await confirm.getByRole("button", { name: "Back" }).click();
  await expect(amount).toHaveValue("50.50");
  await form.getByRole("button", { name: "Review refund" }).click();
  await confirm.getByRole("button", { name: /^Refund .*50\.50/ }).click();
  await expect(form.getByText("This provider does not refund part of a payment.")).toBeVisible();
  expect(refunds).toHaveLength(1);
  const first = refunds[0] as Request;
  expect(first.method()).toBe("POST");
  const firstKey = first.headers()["idempotency-key"];
  expect(firstKey).toMatch(UUID);
  expect(first.postDataJSON()).toEqual({
    amount: { amount: 5050, currency: "UAH" },
    note: "Damaged in transit",
  });
  expect(first.url()).toContain(`/admin/orders/${orderId}/payments/${paymentId}/refunds`);

  // The same request sent again by the admin reuses the key.
  await form.getByRole("button", { name: "Review refund" }).click();
  await confirm.getByRole("button", { name: /^Refund .*50\.50/ }).click();
  await expect.poll(() => refunds.length).toBe(2);
  expect(refunds[1]?.headers()["idempotency-key"]).toBe(firstKey);
  expect(refunds[1]?.postDataJSON()).toEqual(first.postDataJSON());

  // A changed amount is a new request with a new key: the whole amount, which this provider accepts.
  await expect(form.getByText("This provider does not refund part of a payment.")).toBeVisible();
  await amount.fill("189.00");
  await form.getByRole("button", { name: "Review refund" }).click();
  await confirm.getByRole("button", { name: /^Refund .*189\.00/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(refunds).toHaveLength(3);
  const third = refunds[2] as Request;
  expect(third.headers()["idempotency-key"]).toMatch(UUID);
  expect(third.headers()["idempotency-key"]).not.toBe(firstKey);
  expect(third.postDataJSON()).toEqual({
    amount: { amount: 18900, currency: "UAH" },
    note: "Damaged in transit",
  });

  // No provider is loaded, so the API records the refund and answers it failed (`provider_not_loaded`, nothing was sent): the
  // notice says so, the refund is in the table as refused with its code, the money counts as not returned, and the payment
  // carries an attention item the admin can close.
  await expect(panel.getByText("Refund refused")).toBeVisible();
  await expect(
    panel.getByText("Nothing was returned and the amount can be refunded again."),
  ).toBeVisible();
  const table = panel.getByRole("table", { name: "Refunds of this payment" });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Damaged in transit");
  await expect(table).toContainText("By an admin");
  await expect(table).toContainText("Refused");
  await expect(table).toContainText("provider_not_loaded");
  await expect(card).toContainText("This payment needs your attention");
  await expect(card).toContainText("A refund was refused");
  await expect(card.getByRole("button", { name: "Refund" })).toBeVisible();
});

test("payments: an attention item is listed, opened from the list, closed after a confirmation; the viewer is not allowed", async ({
  page,
  signIn,
  openAs,
  shopper,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const placed = await shopper.placeGuestOrder(
    `e2e-attention-${u}@example.com`,
    "demo-screwdriver",
    "DEMO-SCREWDRIVER",
  );
  const orderId = await owner.orderIdByNumber(placed.number);
  await owner.markPaid(orderId, `BANK-${u}`, placed.total);
  const paymentId = await seedSucceededPayment({
    orderId: orderId,
    providerPaymentId: `e2e-att-${u}`,
    amount: placed.total.amount,
    attentionCode: "duplicate_payment",
  });

  await signIn("manager");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await nav.getByRole("link", { name: "Payments to review" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Payments to review" })).toBeVisible();
  const main = page.getByRole("main");
  const list = main.getByRole("table", { name: "Payments that need attention" });
  const row = list.getByRole("row").filter({ hasText: `Order ${placed.number}` });
  await expect(row).toContainText("Paid twice");
  await expect(row).toContainText(FULL);
  // Read only: no action on the list itself.
  await expect(main.getByRole("button", { name: /Refund|Close|Check/ })).toHaveCount(0);

  await row.getByRole("link", { name: `Order ${placed.number}` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Order ${placed.number}` }),
  ).toBeVisible();
  const panel = main.getByRole("region", { name: "Online payment" });
  await expect(panel).toContainText("This payment needs your attention");
  await expect(panel).toContainText("Paid twice");

  // Closing asks first, the safe choice is focused, and keeping it open sends nothing.
  const clears = watch(page, /\/admin\/payments\/[^/]+\/attention\/clear$/);
  await panel.getByRole("button", { name: "Close attention item" }).click();
  const ask = page.getByRole("alertdialog", { name: "Close this attention item?" });
  await expect(ask.getByRole("button", { name: "Keep open" })).toBeFocused();
  await ask.getByRole("button", { name: "Keep open" }).click();
  await expect(ask).toBeHidden();
  expect(clears).toHaveLength(0);

  await panel.getByRole("button", { name: "Close attention item" }).click();
  await ask.getByRole("button", { name: "Close item" }).click();
  await expect(main.getByText("The attention item was closed.")).toBeVisible();
  expect(clears).toHaveLength(1);
  expect(clears[0]?.url()).toContain(`/admin/payments/${paymentId}/attention/clear`);
  expect(clears[0]?.postData()).toBeNull();
  await expect(panel).not.toContainText("This payment needs your attention");
  await expect(panel).toContainText("An earlier attention item was closed: Paid twice.");
  await expect(panel.getByRole("button", { name: "Close attention item" })).toHaveCount(0);
  await panel.getByText(/^Journal \(/).click();
  await expect(panel.getByRole("table", { name: "Journal of this payment" })).toContainText(
    "Attention item closed",
  );

  // The item left the list.
  await nav.getByRole("link", { name: "Payments to review" }).click();
  await expect(main.getByRole("table", { name: "Payments that need attention" })).not.toContainText(
    placed.number,
  );

  // The viewer has no orders.read: no entry, "Not allowed", and no read of the list.
  const viewer = await openAs("viewer");
  const reads = watch(viewer, /\/admin\/payments/);
  await expect(
    viewer
      .getByRole("navigation", { name: "Admin sections" })
      .getByRole("link", { name: "Payments to review" }),
  ).toHaveCount(0);
  await viewer.goto(`${SPA}/payments`);
  await expect(viewer.getByRole("heading", { level: 1, name: "Not allowed" })).toBeVisible();
  expect(reads).toHaveLength(0);
});

test("payments: the attention list pages with keyset 'Load more'", async ({
  page,
  signIn,
  shopper,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const placed = await shopper.placeGuestOrder(
    `e2e-paging-${u}@example.com`,
    "demo-screwdriver",
    "DEMO-SCREWDRIVER",
  );
  const orderId = await owner.orderIdByNumber(placed.number);
  await owner.markPaid(orderId, `BANK-${u}`, placed.total);
  // More than one page of attention items (a page is 20), all on one order, newest last created.
  for (let index = 0; index < 22; index += 1) {
    await seedSucceededPayment({
      orderId: orderId,
      providerPaymentId: `e2e-page-${u}-${String(index)}`,
      amount: 100 + index,
      attentionCode: "reconcile_gave_up",
      createdMinutesAgo: index,
    });
  }

  await signIn("manager");
  const requests = watch(page, /\/admin\/payments\?/);
  await page.goto(`${SPA}/payments`);
  const main = page.getByRole("main");
  const list = main.getByRole("table", { name: "Payments that need attention" });
  await expect(main.getByText("20 shown. There are more.")).toBeVisible();
  await expect(list.getByRole("row")).toHaveCount(21);
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]?.url() ?? "").searchParams.get("cursor")).toBeNull();
  expect(new URL(requests[0]?.url() ?? "").searchParams.get("needsAttention")).toBe("true");

  await main.getByRole("button", { name: "Load more" }).click();
  await expect(main.getByText(/shown\. That is all of them\./)).toBeVisible();
  await expect(main.getByRole("button", { name: "Load more" })).toHaveCount(0);
  expect(requests).toHaveLength(2);
  const cursor = new URL(requests[1]?.url() ?? "").searchParams.get("cursor");
  expect(cursor).not.toBeNull();
  expect((await list.getByRole("row").count()) - 1).toBeGreaterThanOrEqual(22);
  // Every row of the seeded order, once.
  await expect(list.getByRole("row").filter({ hasText: `Order ${placed.number}` })).toHaveCount(22);
});
