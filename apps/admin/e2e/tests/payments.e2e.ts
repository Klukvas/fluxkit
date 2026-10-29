import { randomUUID } from "node:crypto";
import type { Page, Request } from "@playwright/test";
import { SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";
import type { AdminApi, PlacedOrder, StoreApi } from "../support/api.ts";
import { providerPaymentIdOf, webhookBody, type FakeProvider } from "../support/fake-provider.ts";
import { seedSucceededPayment } from "../support/payments-db.ts";

/**
 * The admin payment screens (payments plan steps 10 and 11). The API of this suite runs with the test-only `fake` payment
 * provider and `FAKE_PAYMENT_ADOPT_WEBHOOKS=true`; the suite plays the PROVIDER: it POSTs the fake's signed webhook to the real
 * `POST /webhooks/payments/fake` through the proxy (`support/fake-provider.ts`), so a payment is settled by the API's own
 * code (signature check over the raw body, fact binding, order integration), and the fake's invoice follows the verified
 * webhook so that the refunds the admin makes through the screens reach a paid invoice and really succeed. No test-only
 * route exists in the API. Real here: the SPA, the admin routes and permissions, the webhook path, the refund rules and
 * `Idempotency-Key` handling, the database rules.
 * Seeded rows (`support/payments-db.ts`) remain only where a scenario needs many or unusual attempts the provider cannot
 * produce cheaply: an attention item on a paid order (`duplicate_payment`) and 22 attention items for the keyset paging; the
 * screens and routes they exercise are real, the rows are not a provider's work.
 * NOT covered here: `processing` and `unknown` refund outcomes and a `503` from the provider (the fake's failure hooks
 * cannot cross the process boundary; they are covered by the unit and component specs of the area and the API's integration
 * tests), the automatic refund of a late payment being SENT (job 11 is a worker job; the scheduler is off in this suite, so
 * the scenario asserts it is queued), and the 429 limits.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The money text of the Intl formatter (a no-break space after the currency): the scenarios match the digits. */
const FULL = /189\.00/;

/**
 * An order paid the way a real one is: the shopper starts the payment, the provider's signed webhook arrives. Answers the
 * ids the admin screens and routes use (`paymentId` is the attempt, `providerPaymentId` the fake's invoice).
 */
async function payThroughProvider(
  owner: AdminApi,
  shopper: StoreApi,
  provider: FakeProvider,
  email: string,
): Promise<{ placed: PlacedOrder; orderId: string; paymentId: string; providerPaymentId: string }> {
  const placed = await shopper.placeGuestOrder(email, "demo-screwdriver", "DEMO-SCREWDRIVER");
  const started = await shopper.startGuestPayment(placed);
  const providerPaymentId = providerPaymentIdOf(started.redirectUrl);
  const delivered = await provider.postSigned(
    webhookBody({
      providerPaymentId,
      reference: started.paymentId,
      amount: placed.total.amount,
      status: "success",
      minutes: 10,
    }),
  );
  expect(delivered.status()).toBe(200);
  return {
    placed,
    orderId: await owner.orderIdByNumber(placed.number),
    paymentId: started.paymentId,
    providerPaymentId,
  };
}

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

test("payments: a payment settled by the provider's signed webhook, check status, a partial refund and the rest through the dialogs, the key honoured by the server, over-refunds refused", async ({
  page,
  signIn,
  shopper,
  owner,
  provider,
}, testInfo) => {
  const u = unique(testInfo);
  const { placed, orderId, paymentId, providerPaymentId } = await payThroughProvider(
    owner,
    shopper,
    provider,
    `e2e-refund-${u}@example.com`,
  );
  expect(await owner.orderStatus(orderId)).toBe("paid");

  await signIn("manager");
  await page.goto(`${SPA}/orders/${orderId}`);
  const main = page.getByRole("main");
  const panel = main.getByRole("region", { name: "Online payment" });

  // The attempt as the verified webhook made it: status, amount, provider, the card as system and last four digits only, the journal.
  const card = panel.getByRole("article");
  await expect(card.getByRole("heading", { level: 3 })).toContainText("Payment of");
  await expect(card).toContainText("Paid");
  await expect(card).toContainText(FULL);
  await expect(card).toContainText("visa ending 4242");
  await expect(card).toContainText("The order was marked paid");
  await expect(card.getByRole("table", { name: "Refunds of this payment" })).toContainText(
    "No refunds yet.",
  );
  await card.getByText(/^Journal \(/).click();
  const journal = card.getByRole("table", { name: "Journal of this payment" });
  await expect(journal).toContainText("Payment started");
  await expect(journal).toContainText("Provider notice");
  await expect(journal).toContainText("to Paid");
  // The provider's invoice id is internal: nowhere on the screen.
  await expect(card).not.toContainText(providerPaymentId);

  // Check status reads the provider for real (the fake's invoice followed the verified webhook) and changes nothing.
  const resyncs = watch(page, /\/payments\/[^/]+\/resync$/);
  await card.getByRole("button", { name: "Check status" }).click();
  await expect(panel.getByText(/Checked with the provider at/)).toBeVisible();
  expect(resyncs).toHaveLength(1);
  expect(resyncs[0]?.method()).toBe("POST");
  await expect(card).toContainText("Paid");

  // The server refuses more than was paid, whoever asks and however the screen is used: nothing is recorded.
  const tooMuch = await owner.refund<{ code: string; rule?: string }>(orderId, paymentId, {
    key: randomUUID(),
    amount: { amount: placed.total.amount + 1, currency: "UAH" },
    note: "Too much",
    expected: 409,
  });
  expect(tooMuch.body).toMatchObject({ code: "rule_violation", rule: "refund_exceeds_remaining" });
  expect((await owner.payments(orderId))[0]?.refunds).toEqual([]);

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

  // Back keeps what was typed; forward again, then confirm: the provider accepts the partial refund.
  await confirm.getByRole("button", { name: "Back" }).click();
  await expect(amount).toHaveValue("50.50");
  await form.getByRole("button", { name: "Review refund" }).click();
  await confirm.getByRole("button", { name: /^Refund .*50\.50/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(panel.getByText("Refund done")).toBeVisible();
  expect(refunds).toHaveLength(1);
  const first = refunds[0] as Request;
  expect(first.method()).toBe("POST");
  const firstKey = first.headers()["idempotency-key"] as string;
  expect(firstKey).toMatch(UUID);
  expect(first.postDataJSON()).toEqual({
    amount: { amount: 5050, currency: "UAH" },
    note: "Damaged in transit",
  });
  expect(first.url()).toContain(`/admin/orders/${orderId}/payments/${paymentId}/refunds`);

  const table = panel.getByRole("table", { name: "Refunds of this payment" });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Refunded");
  await expect(table).toContainText("Damaged in transit");
  await expect(table).toContainText("By an admin");
  await expect(card).toContainText("138.50"); // what can still be refunded
  const [afterFirst] = await owner.payments(orderId);
  expect(afterFirst).toMatchObject({
    status: "succeeded",
    refundedAmount: { amount: 5050, currency: "UAH" },
    refundableAmount: { amount: 13850, currency: "UAH" },
    needsAttention: false,
  });
  expect(afterFirst?.refunds).toHaveLength(1);

  // The Idempotency-Key is honoured by the SERVER: the same key and body again (a client that lost the answer) answers the
  // same refund with 200 and moves no money; the same key with another amount is refused.
  const replay = await owner.refund<{ refund: { id: string; status: string } }>(
    orderId,
    paymentId,
    {
      key: firstKey,
      amount: { amount: 5050, currency: "UAH" },
      note: "Damaged in transit",
      expected: 200,
    },
  );
  expect(replay.body.refund).toMatchObject({ id: afterFirst?.refunds[0]?.id, status: "succeeded" });
  const reused = await owner.refund<{ code: string; rule?: string }>(orderId, paymentId, {
    key: firstKey,
    amount: { amount: 5051, currency: "UAH" },
    note: "Damaged in transit",
    expected: 409,
  });
  expect(reused.body.code).toBe("idempotency_key_reused");
  const [afterReplay] = await owner.payments(orderId);
  expect(afterReplay?.refunds).toHaveLength(1);
  expect(afterReplay?.refundedAmount).toEqual({ amount: 5050, currency: "UAH" });

  // The rest through the dialog: it now starts at what is left, with a NEW key.
  await card.getByRole("button", { name: "Refund" }).click();
  await expect(amount).toHaveValue("138.50");
  await form.getByRole("textbox", { name: /Reason/ }).fill("Rest of the order");
  await form.getByRole("button", { name: "Review refund" }).click();
  await confirm.getByRole("button", { name: /^Refund .*138\.50/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(refunds).toHaveLength(2);
  const second = refunds[1] as Request;
  expect(second.headers()["idempotency-key"]).toMatch(UUID);
  expect(second.headers()["idempotency-key"]).not.toBe(firstKey);
  expect(second.postDataJSON()).toEqual({
    amount: { amount: 13850, currency: "UAH" },
    note: "Rest of the order",
  });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(card).toContainText("Refunded");
  await expect(card.getByRole("button", { name: "Refund" })).toHaveCount(0);

  // Everything is returned, the order stays paid (a refund never changes it), and not one more minor unit can go out.
  const [final] = await owner.payments(orderId);
  expect(final).toMatchObject({
    status: "succeeded",
    refundedAmount: placed.total,
    refundableAmount: { amount: 0, currency: "UAH" },
    needsAttention: false,
  });
  expect(final?.refunds.map((refund) => refund.status)).toEqual(["succeeded", "succeeded"]);
  expect(await owner.orderStatus(orderId)).toBe("paid");
  const beyond = await owner.refund<{ code: string; rule?: string }>(orderId, paymentId, {
    key: randomUUID(),
    amount: { amount: 1, currency: "UAH" },
    note: "One more",
    expected: 409,
  });
  expect(beyond.body.code).toBe("rule_violation");
  expect(["refund_exceeds_remaining", "refund_not_allowed"]).toContain(beyond.body.rule);
  expect((await owner.payments(orderId))[0]?.refunds).toHaveLength(2);
});

test("payments: a payment that arrives after the shopper cancelled shows in 'Payments to review' with its queued refund", async ({
  page,
  signIn,
  shopper,
  owner,
  provider,
}, testInfo) => {
  const u = unique(testInfo);
  const placed = await shopper.placeGuestOrder(
    `e2e-late-${u}@example.com`,
    "demo-screwdriver",
    "DEMO-SCREWDRIVER",
  );
  const started = await shopper.startGuestPayment(placed);
  await shopper.cancelGuestOrder(placed);
  const delivered = await provider.postSigned(
    webhookBody({
      providerPaymentId: providerPaymentIdOf(started.redirectUrl),
      reference: started.paymentId,
      amount: placed.total.amount,
      status: "success",
      minutes: 10,
    }),
  );
  expect(delivered.status()).toBe(200);
  expect(await owner.orderStatus(await owner.orderIdByNumber(placed.number))).toBe("cancelled");

  await signIn("manager");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await nav.getByRole("link", { name: "Payments to review" }).click();
  const main = page.getByRole("main");
  const list = main.getByRole("table", { name: "Payments that need attention" });
  const row = list.getByRole("row").filter({ hasText: `Order ${placed.number}` });
  await expect(row).toContainText("Paid after the order could no longer be paid");
  await expect(row).toContainText(FULL);

  await row.getByRole("link", { name: `Order ${placed.number}` }).click();
  const panel = main.getByRole("region", { name: "Online payment" });
  await expect(panel).toContainText("This payment needs your attention");
  await expect(panel).toContainText("The order could no longer be paid (expired or cancelled)");
  // The automatic full refund is queued for the background job (this suite runs no scheduler), so it shows as requested.
  const table = panel.getByRole("table", { name: "Refunds of this payment" });
  await expect(table).toContainText("Automatic: paid too late");
  await expect(table).toContainText("Requested");
  await expect(table).toContainText(FULL);
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
