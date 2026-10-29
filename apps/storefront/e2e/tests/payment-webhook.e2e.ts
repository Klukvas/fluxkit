import { randomUUID } from "node:crypto";
import type { TestInfo } from "@playwright/test";
import type { PlacedOrder, StoreApi } from "../support/api.ts";
import {
  FAKE_PAYMENT_SIGNATURE_HEADER,
  providerPaymentIdOf,
  signFakeWebhook,
  webhookBody,
} from "../support/fake-provider.ts";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";
import { captureCreate, stubProviderPages } from "../support/payment-pages.ts";

/**
 * A payment settled ACROSS PROCESSES (payments plan step 11). The API runs in its own process on a real database, the
 * browser reaches it through the proxy, and the test plays the PAYMENT PROVIDER: it POSTs the webhook the provider would
 * send to the real `POST /webhooks/payments/fake` (the proxy forwards the exact bytes, like the production edge proxy), signed
 * with the fake's public test key (`support/fake-provider.ts`). No test-only route exists in the API. What is real: the raw
 * body reader, the signature check over the exact bytes, fact binding, the order integration (`markPaidIn`), the journal, the
 * shopper's status route and the return page, the admin views. What is NOT covered here: job 11 (the scheduler is off in this
 * suite and the `jobs:run-once` command would run in a process that does not hold the fake's invoices, so the automatic refund
 * of a late payment is asserted as QUEUED, not sent; the sending is covered by the API's integration tests), the provider's
 * own page (Playwright stubs that host), and anything Monobank-specific (its ECDSA signature, key handling).
 */

const DIGITAL_PRODUCT = "demo-e-book";

interface Started {
  order: PlacedOrder;
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
}

async function placeOrder(
  shopper: StoreApi,
  admin: { orderOf(email: string): Promise<{ id: string }> },
  testInfo: TestInfo,
): Promise<{ order: PlacedOrder; orderId: string }> {
  const variant = (await shopper.product(DIGITAL_PRODUCT)).variants[0];
  if (variant === undefined) throw new Error(`The seed has no variant for ${DIGITAL_PRODUCT}.`);
  await shopper.addToCart(variant.id, 1);
  const email = uniqueEmail(testInfo, "webhook");
  const order = await shopper.checkout({ email, idempotencyKey: randomUUID(), shipping: false });
  return { order, orderId: (await admin.orderOf(email)).id };
}

/** An order whose online payment was started by the pay button's call (the page part is covered by `payment.e2e.ts`). */
async function startedPayment(
  shopper: StoreApi,
  admin: Parameters<typeof placeOrder>[1],
  testInfo: TestInfo,
): Promise<Started> {
  const { order, orderId } = await placeOrder(shopper, admin, testInfo);
  const payment = await shopper.startGuestPayment(order, randomUUID());
  expect(payment.status).toBe("waiting");
  return {
    order,
    orderId,
    paymentId: payment.paymentId,
    providerPaymentId: providerPaymentIdOf(payment.redirectUrl),
  };
}

/** The announcement of a paid invoice, as the provider would send it. */
function paidBody(started: Started, overrides: Partial<Parameters<typeof webhookBody>[0]> = {}) {
  return webhookBody({
    providerPaymentId: started.providerPaymentId,
    reference: started.paymentId,
    amount: started.order.total.amount,
    status: "success",
    minutes: 10,
    ...overrides,
  });
}

test("a paid order across processes: Pay now, the provider's signed webhook, the return page turns to paid, a replay changes nothing", async ({
  page,
  shopper,
  admin,
  provider,
}, testInfo) => {
  const { order, orderId } = await placeOrder(shopper, admin, testInfo);
  await stubProviderPages(page);
  const created = await captureCreate(page, "/store/orders/payments");

  await page.goto(`/en/order/${order.number}#t=${order.accessToken}`);
  await waitForHydration(page);
  await page
    .getByRole("region", { name: "Payment", exact: true })
    .getByRole("button", { name: "Pay now" })
    .click();
  const started = await created();
  await page.waitForURL(started.redirectUrl);

  // The provider sends the shopper back; the attempt is still waiting.
  await page.goto(`/en/payment/return?payment=${started.paymentId}`);
  const result = page.locator("#payment-return-result");
  await expect(result).toContainText("Waiting for the payment");
  expect(await admin.orderStatus(orderId)).toBe("awaiting_payment");

  // The provider's server tells the shop the payment succeeded. The page (polling every 3 s) turns to paid by itself.
  const body = webhookBody({
    providerPaymentId: providerPaymentIdOf(started.redirectUrl),
    reference: started.paymentId,
    amount: order.total.amount,
    status: "success",
    minutes: 10,
  });
  const delivered = await provider.postSigned(body);
  expect(delivered.status()).toBe(200);
  expect(await delivered.text()).toBe("");
  await expect(result).toContainText("Payment received", { timeout: 20_000 });
  await expect(result).toContainText("Order status: Paid");

  // The admin sees what the API recorded from the verified fact: paid once, applied, the card as system and last digits only.
  const [attempt, ...others] = await admin.paymentsOf(orderId);
  expect(others).toEqual([]);
  expect(attempt).toMatchObject({
    status: "succeeded",
    orderOutcome: "applied",
    needsAttention: false,
    finalAmount: order.total,
    refundableAmount: order.total,
  });
  expect(await admin.orderStatus(orderId)).toBe("paid");
  const historyBefore = attempt?.history ?? [];
  expect(historyBefore.some((entry) => entry.toStatus === "succeeded" && entry.applied)).toBe(true);

  // The provider retries the same notification (it does, until it gets a 200): the exact bytes again change nothing.
  const replay = await provider.postSigned(body);
  expect(replay.status()).toBe(200);
  const [after] = await admin.paymentsOf(orderId);
  expect(after?.history).toEqual(historyBefore);
  expect(after).toMatchObject({ status: "succeeded", orderOutcome: "applied", refunds: [] });
  expect(await admin.orderStatus(orderId)).toBe("paid");
  await expect(result).toContainText("Payment received");
});

test("a forged, unsigned or altered webhook is refused and changes nothing; the genuine one still works", async ({
  shopper,
  admin,
  provider,
}, testInfo) => {
  const started = await startedPayment(shopper, admin, testInfo);
  const body = paidBody(started);
  const bytes = Buffer.from(body, "utf8");
  const nothingChanged = async () => {
    const [attempt, ...others] = await admin.paymentsOf(started.orderId);
    expect(others).toEqual([]);
    expect(attempt).toMatchObject({ status: "awaiting_customer", needsAttention: false });
    // Only the creation is journaled; a refused webhook leaves no row.
    expect(attempt?.history.every((entry) => entry.toStatus !== "succeeded")).toBe(true);
    expect(await admin.orderStatus(started.orderId)).toBe("awaiting_payment");
  };
  const before = (await admin.paymentsOf(started.orderId))[0]?.history ?? [];

  // No signature at all.
  expect((await provider.post(body)).status()).toBe(401);
  // A signature that is not the HMAC of the body (right shape, wrong value), and one that is not even hex.
  expect(
    (await provider.post(body, { [FAKE_PAYMENT_SIGNATURE_HEADER]: "0".repeat(64) })).status(),
  ).toBe(401);
  expect(
    (await provider.post(body, { [FAKE_PAYMENT_SIGNATURE_HEADER]: "not-a-signature" })).status(),
  ).toBe(401);
  // The signature of ANOTHER body (a genuine one for a failed payment replayed onto a success).
  const otherSignature = signFakeWebhook(
    Buffer.from(paidBody(started, { status: "failure", finalAmount: null }), "utf8"),
  );
  expect(
    (await provider.post(body, { [FAKE_PAYMENT_SIGNATURE_HEADER]: otherSignature })).status(),
  ).toBe(401);
  // A genuine signature over a body changed by ONE byte afterwards (a trailing space): the check is over the exact bytes.
  const genuine = signFakeWebhook(bytes);
  expect(
    (
      await provider.post(Buffer.concat([bytes, Buffer.from(" ")]), {
        [FAKE_PAYMENT_SIGNATURE_HEADER]: genuine,
      })
    ).status(),
  ).toBe(401);
  expect((await admin.paymentsOf(started.orderId))[0]?.history).toEqual(before);
  await nothingChanged();

  // Not JSON: refused before anything is verified, even with a valid signature.
  const plain = await provider.context.post("/webhooks/payments/fake", {
    headers: { "content-type": "text/plain", [FAKE_PAYMENT_SIGNATURE_HEADER]: genuine },
    data: bytes,
    failOnStatusCode: false,
  });
  expect(plain.status()).toBe(415);
  // A provider that is not enabled: the same answer as any unknown route.
  expect(
    (
      await provider.context.post("/webhooks/payments/nobody", {
        data: "{}",
        failOnStatusCode: false,
      })
    ).status(),
  ).toBe(404);
  await nothingChanged();

  // Control: the genuine webhook is accepted, so the refusals above were about the forgery and not about the route.
  expect((await provider.postSigned(body)).status()).toBe(200);
  expect(await admin.orderStatus(started.orderId)).toBe("paid");
  expect((await admin.paymentsOf(started.orderId))[0]).toMatchObject({
    status: "succeeded",
    orderOutcome: "applied",
  });
});

test("a body over the 64 KiB limit is refused with 413 and nothing is recorded", async ({
  shopper,
  admin,
  provider,
}, testInfo) => {
  const started = await startedPayment(shopper, admin, testInfo);
  const padded = paidBody(started).slice(0, -1) + `,"padding":"${"x".repeat(70_000)}"}`;
  const answer = await provider.postSigned(padded);
  expect(answer.status()).toBe(413);
  expect((await admin.paymentsOf(started.orderId))[0]).toMatchObject({
    status: "awaiting_customer",
  });
  expect(await admin.orderStatus(started.orderId)).toBe("awaiting_payment");
});

test("a signed success for another amount is flagged for attention and never marks the order paid", async ({
  page,
  shopper,
  admin,
  provider,
}, testInfo) => {
  const started = await startedPayment(shopper, admin, testInfo);
  const wrongAmount = started.order.total.amount - 100;

  // The provider announces a success for LESS than the order total (the invoice amount the shop sent is not what was taken).
  const answer = await provider.postSigned(
    paidBody(started, { amount: wrongAmount, finalAmount: wrongAmount }),
  );
  expect(answer.status()).toBe(200);

  expect(await admin.orderStatus(started.orderId)).toBe("awaiting_payment");
  const [attempt] = await admin.paymentsOf(started.orderId);
  expect(attempt).toMatchObject({ needsAttention: true });
  expect(attempt?.status).not.toBe("succeeded");
  expect(attempt?.attentionCode).toBe("amount_mismatch");
  // The fact was journaled but NOT applied.
  expect(
    attempt?.history.filter((entry) => entry.source === "webhook" && !entry.applied),
  ).toHaveLength(1);

  // The shopper's page does not say paid.
  const status = await shopper.guestPaymentStatus(started.order, started.paymentId);
  expect(status.status).not.toBe("paid");
  expect(status.orderStatus).not.toBe("paid");
  await page.goto(`/en/order/${started.order.number}#t=${started.order.accessToken}`);
  await expect(page.getByText("Payment received")).toHaveCount(0);

  // An invoice of ANOTHER amount than the shop sent, even one whose final amount equals the order total, does not bind
  // (this case differs from the one above: the final-amount rule alone would let it through).
  const otherInvoice = await provider.postSigned(
    paidBody(started, {
      amount: started.order.total.amount + 100,
      finalAmount: started.order.total.amount,
      minutes: 12,
    }),
  );
  expect(otherInvoice.status()).toBe(200);
  expect(await admin.orderStatus(started.orderId)).toBe("awaiting_payment");
  expect((await admin.paymentsOf(started.orderId))[0]).toMatchObject({
    status: "awaiting_customer",
    needsAttention: true,
    attentionCode: "amount_mismatch",
  });

  // The right amount but a FINAL amount of less than was charged is the same kind of lie.
  const short = await provider.postSigned(
    paidBody(started, { finalAmount: wrongAmount, minutes: 11 }),
  );
  expect(short.status()).toBe(200);
  expect(await admin.orderStatus(started.orderId)).toBe("awaiting_payment");
  expect((await admin.paymentsOf(started.orderId))[0]).toMatchObject({
    needsAttention: true,
    attentionCode: "amount_mismatch",
  });

  // A success for the right amount from the same invoice (a corrected notification) is not blocked by the earlier flag.
  const genuine = await provider.postSigned(paidBody(started, { minutes: 20 }));
  expect(genuine.status()).toBe(200);
  expect(await admin.orderStatus(started.orderId)).toBe("paid");
});

test("a payment that arrives after the shopper cancelled raises the late-payment flag and queues a full refund; the order stays cancelled", async ({
  shopper,
  admin,
  provider,
}, testInfo) => {
  const started = await startedPayment(shopper, admin, testInfo);
  await shopper.cancelGuestOrder(started.order);
  expect(await admin.orderStatus(started.orderId)).toBe("cancelled");

  expect((await provider.postSigned(paidBody(started))).status()).toBe(200);

  expect(await admin.orderStatus(started.orderId)).toBe("cancelled");
  const [attempt] = await admin.paymentsOf(started.orderId);
  expect(attempt).toMatchObject({
    status: "succeeded",
    orderOutcome: "order_not_payable",
    needsAttention: true,
    attentionCode: "late_payment",
  });
  // The full refund is queued for job 11 (`requested`); this suite runs no scheduler, so it is not sent (see the file header).
  expect(attempt?.refunds).toHaveLength(1);
  expect(attempt?.refunds[0]).toMatchObject({
    status: "requested",
    reason: "late_payment",
    amount: started.order.total,
  });
  // The shopper is told the payment could not be accepted, not that it was paid.
  const status = await shopper.guestPaymentStatus(started.order, started.paymentId);
  expect(status).toMatchObject({ status: "failed", failureCategory: "not_accepted" });
});
