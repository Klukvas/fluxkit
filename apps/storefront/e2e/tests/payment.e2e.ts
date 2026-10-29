import { randomUUID } from "node:crypto";
import type { Page, Route, TestInfo } from "@playwright/test";
import type { StoreApi } from "../support/api.ts";
import { E2E_ORIGIN } from "../support/env.ts";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { orderNumberOnPage, tabTo, tokenOf, waitForHydration } from "../support/flows.ts";
import { PROVIDER_HOST, captureCreate, stubProviderPages } from "../support/payment-pages.ts";

/**
 * Online payment in the storefront (payments plan step 9). The API of this suite runs with the test-only `fake` payment
 * provider (`PAYMENT_PROVIDERS_ENABLED=fake`, `support/env.ts`). That provider is driven only from inside the API process
 * (no HTTP bridge exists, and the production API gets no test-only route), so the suite can START payments for real
 * (create, redirect URL, status reads) but cannot make the provider PAY or FAIL one. What this file covers:
 *
 * - REAL stack: the pay step on the guest and the account order page, the create call with an Idempotency-Key, the redirect
 *   to the provider's https page (the browser is sent there; Playwright answers that host with a stub page, nothing leaves
 *   the machine), "Continue payment" without a second attempt, the return page reading the real status route (the fake
 *   invoice stays `waiting`), the hand-off in `sessionStorage`, and that nothing in the query string is trusted.
 * - BROWSER-LEVEL STUBS (`page.route` on the shop's own API paths, named as such): the states the fake cannot produce
 *   (a lost provider answer with a countdown, a refused create, a payment already in progress, an unsafe redirect URL, a
 *   network failure, and a status that moves from processing to paid or failed). They test the page, not the API.
 *
 * The API's own behaviour for paid/failed is covered by the API's integration tests, not here.
 */

interface PlacedGuestOrder {
  number: string;
  accessToken: string;
}

async function digitalVariantId(shopper: StoreApi): Promise<string> {
  const variant = (await shopper.product("demo-e-book")).variants[0];
  if (variant === undefined) throw new Error("The seed has no variant for demo-e-book.");
  return variant.id;
}

async function placeGuestOrder(shopper: StoreApi, testInfo: TestInfo): Promise<PlacedGuestOrder> {
  await shopper.addToCart(await digitalVariantId(shopper), 1);
  const order = await shopper.checkout({
    email: uniqueEmail(testInfo, "pay"),
    idempotencyKey: randomUUID(),
    shipping: false,
  });
  if (order.accessToken === undefined) throw new Error("A guest order has an access token.");
  return { number: order.number, accessToken: order.accessToken };
}

const guestLink = (order: PlacedGuestOrder) => `/en/order/${order.number}#t=${order.accessToken}`;

async function openGuestOrder(page: Page, order: PlacedGuestOrder): Promise<void> {
  await page.goto(guestLink(order));
  await expect(
    page.getByRole("heading", { level: 1, name: `Order ${order.number}` }),
  ).toBeVisible();
  await waitForHydration(page);
}

const paymentSection = (page: Page) => page.getByRole("region", { name: "Payment", exact: true });
const payNow = (page: Page) => paymentSection(page).getByRole("button", { name: "Pay now" });

const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "about:blank",
    title: "Problem",
    status,
    code,
    detail: "English detail that the page must never show",
    ...extra,
  });

function fulfillProblem(
  route: Route,
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/problem+json",
    headers,
    body: problem(status, code, extra),
  });
}

test("a guest pays online: the pay step, the redirect, the return page, and 'Continue payment' without a second attempt", async ({
  page,
  shopper,
}, testInfo) => {
  const order = await placeGuestOrder(shopper, testInfo);
  const visited = await stubProviderPages(page);
  const created: { url: string; key: string | undefined }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/store/orders/payments")) {
      created.push({ url: request.url(), key: request.headers()["idempotency-key"] });
    }
  });

  const createdAnswer = await captureCreate(page, "/store/orders/payments");

  await openGuestOrder(page, order);
  // The pay step replaces the "the shop will contact you" wording.
  await expect(paymentSection(page).getByText("Pay for this order online by card")).toBeVisible();
  await expect(page.getByText("The shop will contact you to arrange payment")).toHaveCount(0);

  await payNow(page).click();
  const body = await createdAnswer();
  expect(body.status).toBe("waiting");
  // The browser is sent to the https page the API gave, by a navigation.
  await page.waitForURL(body.redirectUrl);
  await expect(page.getByRole("heading", { name: "Stub provider page" })).toBeVisible();
  expect(visited).toEqual([body.redirectUrl]);
  expect(created).toHaveLength(1);
  expect(created[0]?.key).toMatch(/^[0-9a-f-]{36}$/);

  // The provider sends the shopper back to the return URL: the same tab, an attempt id in the query, nothing else.
  await page.goto(`/en/payment/return?payment=${body.paymentId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Payment result" })).toBeVisible();
  const result = page.locator("#payment-return-result");
  await expect(result).toContainText("Waiting for the payment");
  await expect(result).toContainText(`Order ${order.number}`);
  await expect(result).toContainText("Order status: Awaiting payment");
  expect(page.url()).not.toContain(order.accessToken);
  // The hand-off holds the order and the token for this trip only, in sessionStorage.
  const handoff = await page.evaluate(() => window.sessionStorage.getItem("fluxkit.paymentReturn"));
  expect(JSON.parse(handoff ?? "null")).toEqual({
    kind: "guest",
    number: order.number,
    accessToken: order.accessToken,
    paymentId: body.paymentId,
  });

  // Nothing in the query is trusted: a forged status, amount and order number change nothing on the page.
  await page.goto(
    `/en/payment/return?payment=${body.paymentId}&status=paid&amount=1&number=EVIL-0000&token=forged`,
  );
  await expect(result).toContainText("Waiting for the payment");
  await expect(result).toContainText(`Order ${order.number}`);
  await expect(page.getByText("Payment received")).toHaveCount(0);
  await expect(page.getByText("EVIL-0000")).toHaveCount(0);

  // Back to the order: the attempt still waits, so the page offers to CONTINUE it (no second create call).
  await page.getByRole("link", { name: "Back to the order" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Order ${order.number}` }),
  ).toBeVisible();
  await expect(paymentSection(page).getByText("Waiting for payment")).toBeVisible();
  await paymentSection(page).getByRole("button", { name: "Continue payment" }).click();
  await page.waitForURL(body.redirectUrl);
  expect(visited).toEqual([body.redirectUrl, body.redirectUrl]);
  expect(created).toHaveLength(1);
});

test("a visitor without the hand-off (another browser or device) is told to open the order, and sees nothing of any payment", async ({
  page,
  shopper,
  browser,
}, testInfo) => {
  const order = await placeGuestOrder(shopper, testInfo);
  await stubProviderPages(page);
  const createdAnswer = await captureCreate(page, "/store/orders/payments");
  await openGuestOrder(page, order);
  await payNow(page).click();
  const { paymentId } = await createdAnswer();

  const other = await browser.newContext({ baseURL: E2E_ORIGIN });
  try {
    const stranger = await other.newPage();
    const statusCalls: string[] = [];
    stranger.on("request", (request) => {
      if (request.url().includes("/payments")) statusCalls.push(request.url());
    });
    await stranger.goto(`/en/payment/return?payment=${paymentId}`);
    await expect(stranger.getByRole("heading", { level: 1, name: "Payment result" })).toBeVisible();
    await expect(stranger.locator("#payment-return-result")).toContainText(
      "Open your order to see the result",
    );
    await expect(stranger.getByText(order.number)).toHaveCount(0);
    // No request about the payment is made without the order and token the page was not given.
    expect(statusCalls).toEqual([]);
  } finally {
    await other.close();
  }
});

test("a customer pays an own order: the account route, a hand-off without any token, the return page by session", async ({
  page,
  shopper,
}, testInfo) => {
  await shopper.register(uniqueEmail(testInfo, "customer-pay"), "a long e2e password 123");
  await shopper.addToCart(await digitalVariantId(shopper), 1);
  const order = await shopper.checkout({ idempotencyKey: randomUUID(), shipping: false });
  await stubProviderPages(page);
  const createdAnswer = await captureCreate(page, `/store/account/orders/${order.number}/payments`);

  await page.goto(`/en/account/orders/${order.number}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Order ${order.number}` }),
  ).toBeVisible();
  await waitForHydration(page);
  await payNow(page).click();
  const body = await createdAnswer();
  await page.waitForURL(body.redirectUrl);

  await page.goto(`/en/payment/return?payment=${body.paymentId}`);
  await expect(page.locator("#payment-return-result")).toContainText("Waiting for the payment");
  const handoff = await page.evaluate(() => window.sessionStorage.getItem("fluxkit.paymentReturn"));
  expect(JSON.parse(handoff ?? "null")).toEqual({
    kind: "account",
    number: order.number,
    paymentId: body.paymentId,
  });
  await page.getByRole("link", { name: "Back to the order" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/account/orders/${order.number}$`));
});

test("keyboard: Tab reaches 'Pay now' and Enter starts the payment; a refused start moves the focus to the message", async ({
  page,
  shopper,
}, testInfo) => {
  const order = await placeGuestOrder(shopper, testInfo);
  await openGuestOrder(page, order);
  // BROWSER-LEVEL STUB: the shop's create route refuses with "payment in progress".
  await page.route("**/store/orders/payments", (route) =>
    fulfillProblem(route, 409, "rule_violation", { rule: "payment_in_progress" }),
  );
  await tabTo(page, payNow(page));
  await expect(payNow(page)).toBeFocused();
  const reread = page.waitForRequest((request) => request.url().includes("/store/orders/lookup"));
  await page.keyboard.press("Enter");
  const message = page.locator("#order-payment-message");
  await expect(message).toContainText("A payment for this order is already in progress");
  await expect(message).toBeFocused();
  // The page is not a dead end: the order was read again, to show where it stands now.
  await reread;
});

test.describe("states the fake provider cannot produce (BROWSER-LEVEL STUBS of the shop's own API paths)", () => {
  test("a lost provider answer (503, canRetry false): a countdown, no new payment, then 'Check payment status'", async ({
    page,
    shopper,
  }, testInfo) => {
    const order = await placeGuestOrder(shopper, testInfo);
    const paymentId = randomUUID();
    let creates = 0;
    await page.route("**/store/orders/payments", async (route) => {
      creates += 1;
      await fulfillProblem(
        route,
        503,
        "payment_provider_unavailable",
        { payment: { paymentId, status: "processing", canRetry: false } },
        { "Retry-After": "4" },
      );
    });
    await openGuestOrder(page, order);
    await payNow(page).click();

    const message = page.locator("#order-payment-message");
    await expect(message).toContainText("Do not start another payment");
    await expect(message).toBeFocused();
    // Not a new payment: the only control is the status check, disabled while the countdown runs.
    const check = paymentSection(page).getByRole("button", { name: "Check payment status" });
    await expect(check).toBeDisabled();
    await expect(
      paymentSection(page).getByText(/You can try again in \d seconds?\./),
    ).toBeVisible();
    await expect(paymentSection(page).getByRole("button", { name: /Pay (now|again)/ })).toHaveCount(
      0,
    );
    await expect(check).toBeEnabled({ timeout: 10_000 });
    await expect(paymentSection(page).getByRole("status")).toContainText("You can try again now.");
    expect(creates).toBe(1);

    // The status check goes to the return page, which reads the status route (stubbed: still processing).
    await page.route("**/store/orders/payments/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paymentId,
          status: "processing",
          failureCategory: null,
          expiresAt: "2099-01-01T00:00:00.000Z",
          orderStatus: "awaiting_payment",
          canRetry: false,
        }),
      }),
    );
    await check.click();
    await expect(page).toHaveURL(new RegExp(`/en/payment/return\\?payment=${paymentId}$`));
    await expect(page.locator("#payment-return-result")).toContainText(
      "Your payment is being processed",
    );
  });

  test("a refused create (503, canRetry true): 'Pay again' after the wait, with a NEW Idempotency-Key", async ({
    page,
    shopper,
  }, testInfo) => {
    const order = await placeGuestOrder(shopper, testInfo);
    await stubProviderPages(page);
    const keys: (string | undefined)[] = [];
    await page.route("**/store/orders/payments", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 1) {
        await fulfillProblem(
          route,
          503,
          "payment_provider_unavailable",
          { payment: { paymentId: randomUUID(), status: "failed", canRetry: true } },
          { "Retry-After": "2" },
        );
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          paymentId: randomUUID(),
          status: "waiting",
          redirectUrl: `${PROVIDER_HOST}/pay/stub-1`,
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      });
    });
    await openGuestOrder(page, order);
    await payNow(page).click();
    await expect(page.locator("#order-payment-message")).toContainText("You can try again");
    const again = paymentSection(page).getByRole("button", { name: "Pay again" });
    await expect(again).toBeDisabled();
    await expect(again).toBeEnabled({ timeout: 10_000 });
    await again.click();
    await page.waitForURL(`${PROVIDER_HOST}/pay/stub-1`);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  test("a lost answer (network failure): the SAME Idempotency-Key is sent again, so a retry can only find the attempt", async ({
    page,
    shopper,
  }, testInfo) => {
    const order = await placeGuestOrder(shopper, testInfo);
    await stubProviderPages(page);
    const keys: (string | undefined)[] = [];
    await page.route("**/store/orders/payments", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 1) {
        await route.abort("connectionreset");
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paymentId: randomUUID(),
          status: "waiting",
          redirectUrl: `${PROVIDER_HOST}/pay/stub-2`,
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      });
    });
    await openGuestOrder(page, order);
    await payNow(page).click();
    await expect(page.locator("#order-payment-message")).toBeVisible();
    await expect(page.locator("#order-payment-message").getByRole("alert")).toBeVisible();
    await paymentSection(page).getByRole("button", { name: "Pay again" }).click();
    await page.waitForURL(`${PROVIDER_HOST}/pay/stub-2`);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  for (const redirectUrl of ["http://pay.example.com/insecure", "javascript:alert(1)"]) {
    test(`an unsafe redirect URL in the answer is never followed (${redirectUrl})`, async ({
      page,
      shopper,
    }, testInfo) => {
      const order = await placeGuestOrder(shopper, testInfo);
      await page.route("**/store/orders/payments", (route) =>
        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            paymentId: randomUUID(),
            status: "waiting",
            redirectUrl,
            expiresAt: "2099-01-01T00:00:00.000Z",
          }),
        }),
      );
      await openGuestOrder(page, order);
      const before = page.url();
      await payNow(page).click();
      await expect(page.locator("#order-payment-message")).toContainText(
        "The payment page could not be opened",
      );
      expect(page.url()).toBe(before);
    });
  }

  test("the return page polls: processing, then paid. The hand-off is cleared and the way back is offered", async ({
    page,
    shopper,
  }, testInfo) => {
    const order = await placeGuestOrder(shopper, testInfo);
    const paymentId = randomUUID();
    const requests: unknown[] = [];
    const answers = ["processing", "processing", "paid"];
    await page.route("**/store/orders/payments/status", async (route) => {
      requests.push(route.request().postDataJSON());
      const status = answers[Math.min(requests.length - 1, answers.length - 1)];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paymentId,
          status,
          failureCategory: null,
          expiresAt: "2099-01-01T00:00:00.000Z",
          orderStatus: status === "paid" ? "paid" : "awaiting_payment",
          canRetry: false,
        }),
      });
    });
    await page.goto(guestLink(order));
    await expect(page.getByRole("heading", { level: 1, name: /^Order / })).toBeVisible();
    await page.evaluate(
      ([number, accessToken, id]) =>
        window.sessionStorage.setItem(
          "fluxkit.paymentReturn",
          JSON.stringify({ kind: "guest", number, accessToken, paymentId: id }),
        ),
      [order.number, order.accessToken, paymentId],
    );
    await page.goto(`/en/payment/return?payment=${paymentId}`);
    const result = page.locator("#payment-return-result");
    await expect(result).toContainText("Your payment is being processed");
    await expect(result).toHaveAttribute("aria-busy", "true");
    // A poll every 3 seconds; the third answer is final.
    await expect(result).toContainText("Payment received", { timeout: 15_000 });
    await expect(result).toHaveAttribute("aria-busy", "false");
    await expect(result).toContainText("Order status: Paid");
    // The answers are asked with the order, token and attempt id of the hand-off and nothing from anywhere else.
    expect(requests[0]).toEqual({
      number: order.number,
      accessToken: order.accessToken,
      paymentId,
    });
    expect(requests).toHaveLength(3);
    // Settled: the token is gone from the tab's storage and no further request is made.
    expect(
      await page.evaluate(() => window.sessionStorage.getItem("fluxkit.paymentReturn")),
    ).toBeNull();
    await page.waitForTimeout(4000);
    expect(requests).toHaveLength(3);
    // The link back carries the order's own token (a guest has no other way to it).
    const back = page.getByRole("link", { name: "Back to the order" });
    await expect(back).toHaveAttribute("href", guestLink(order));
    await back.click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Order ${order.number}` }),
    ).toBeVisible();
    expect(tokenOf(page.url())).toBe(order.accessToken);
    await expect(orderNumberOnPage(page)).resolves.toBe(order.number);
  });

  test("a declined payment says why and offers to try again; the page is not a dead end", async ({
    page,
    shopper,
  }, testInfo) => {
    const order = await placeGuestOrder(shopper, testInfo);
    const paymentId = randomUUID();
    await page.route("**/store/orders/payments/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paymentId,
          status: "failed",
          failureCategory: "declined",
          expiresAt: "2099-01-01T00:00:00.000Z",
          orderStatus: "awaiting_payment",
          canRetry: true,
        }),
      }),
    );
    await page.goto(guestLink(order));
    await expect(page.getByRole("heading", { level: 1, name: /^Order / })).toBeVisible();
    await page.evaluate(
      ([number, accessToken, id]) =>
        window.sessionStorage.setItem(
          "fluxkit.paymentReturn",
          JSON.stringify({ kind: "guest", number, accessToken, paymentId: id }),
        ),
      [order.number, order.accessToken, paymentId],
    );
    await page.goto(`/en/payment/return?payment=${paymentId}`);
    const result = page.locator("#payment-return-result");
    await expect(result).toContainText("The payment did not go through");
    await expect(result).toContainText("The bank declined the payment");
    await expect(
      page.getByText("If you have questions about a payment, contact the shop."),
    ).toBeVisible();
    await page.getByRole("link", { name: "Try to pay again" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Order ${order.number}` }),
    ).toBeVisible();
    await expect(payNow(page)).toBeVisible();
  });

  test("an unknown attempt is one 'not found' state", async ({ page, shopper }, testInfo) => {
    const order = await placeGuestOrder(shopper, testInfo);
    await page.goto(guestLink(order));
    await expect(page.getByRole("heading", { level: 1, name: /^Order / })).toBeVisible();
    const unknown = randomUUID();
    await page.evaluate(
      ([number, accessToken, id]) =>
        window.sessionStorage.setItem(
          "fluxkit.paymentReturn",
          JSON.stringify({ kind: "guest", number, accessToken, paymentId: id }),
        ),
      [order.number, order.accessToken, unknown],
    );
    // REAL status route: an attempt that does not exist is a 404 like every other miss.
    await page.goto(`/en/payment/return?payment=${unknown}`);
    await expect(page.locator("#payment-return-result")).toContainText("Payment not found");
  });
});
