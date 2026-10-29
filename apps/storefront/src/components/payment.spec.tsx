import type {
  Order,
  PaymentState,
  ShopperPaymentFailureCategory,
  ShopperPaymentStatus,
} from "@fluxkit/api-client";
import { Button, createTranslator, locales } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PaymentWatchState } from "../lib/payment-poll";
import type { PaymentSectionModel } from "../lib/payment-model";
import type { PaymentReturn } from "../lib/payment-return";
import { initialPayState, type PayState } from "../lib/payment-store";
import { messagesByLocale } from "../messages";
import { OrderDetailsView } from "./order-details";
import {
  PAYMENT_FOCUS_IDS,
  PaymentSectionView,
  payOutcomeText,
  type PaymentSectionViewProps,
} from "./payment-section";
import { PaymentReturnView, RETURN_RESULT_ID } from "./payment-return-page";
import { findElements, leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

const ID = "6f1c1d8e-5f0a-4f6e-9a0b-0c2f4b7d1a11";
const TOKEN = "A".repeat(43);
const PAGE = "https://pay.example.com/pay/1";
const t = sentinelTranslator();

const model = (over: Partial<PaymentSectionModel> = {}): PaymentSectionModel => ({
  action: "pay",
  status: null,
  failureCategory: null,
  expiresAt: null,
  continueUrl: null,
  paymentId: null,
  ...over,
});

function section(over: Partial<PaymentSectionViewProps> = {}) {
  return PaymentSectionView({
    t,
    locale: "uk",
    model: model(),
    orderExpiresAt: "2026-10-29T12:00:00.000Z",
    pay: initialPayState,
    now: 0,
    onPay: vi.fn(),
    onContinue: vi.fn(),
    onCheckStatus: vi.fn(),
    ...over,
  });
}

const html = (element: ReturnType<typeof section>) => renderToStaticMarkup(element);
const failed = (over: Partial<PayState>): PayState => ({
  ...initialPayState,
  phase: "failed",
  ...over,
});
const buttons = (root: ReturnType<typeof section>) =>
  findElements(root, (el) => el.type === Button);

describe("PaymentSectionView", () => {
  it("offers Pay now with the intro, the deadline and a status-less section", () => {
    const markup = html(section());
    expect(markup).toContain("§payment.title");
    expect(markup).toContain("§payment.intro");
    expect(markup).toContain("§payment.awaiting");
    expect(markup).toContain("§payment.pay<");
    expect(markup).not.toContain("§payment.status.label");
    expect(buttons(section())).toHaveLength(1);
  });

  it("calls onPay from the one button, and shows it disabled and busy while the request runs", () => {
    const onPay = vi.fn();
    const [button] = buttons(section({ onPay }));
    (button?.props["onClick"] as () => void)();
    expect(onPay).toHaveBeenCalledTimes(1);

    const pending = section({ pay: { ...initialPayState, phase: "pending" } });
    const [busy] = buttons(pending);
    expect(busy?.props["disabled"]).toBe(true);
    expect(busy?.props["aria-busy"]).toBe(true);
    expect(html(pending)).toContain("§payment.opening");
  });

  it("keeps the button disabled while the browser is on its way to the provider, and says so in the live region", () => {
    const redirecting = section({ pay: { ...initialPayState, phase: "redirecting" } });
    expect(buttons(redirecting)[0]?.props["disabled"]).toBe(true);
    expect(html(redirecting)).toMatch(/role="status"[^>]*>[^<]*§payment\.redirecting/);
  });

  it("offers Continue payment for a waiting attempt, which opens the checked page and never starts a new attempt", () => {
    const onContinue = vi.fn();
    const onPay = vi.fn();
    const view = section({
      model: model({ action: "continue", status: "waiting", continueUrl: PAGE, paymentId: ID }),
      onContinue,
      onPay,
    });
    const found = buttons(view);
    expect(found).toHaveLength(1);
    (found[0]?.props["onClick"] as () => void)();
    expect(onContinue).toHaveBeenCalledExactlyOnceWith(PAGE, ID);
    expect(onPay).not.toHaveBeenCalled();
    expect(html(view)).toContain("§payment.continue");
  });

  it("offers the status check, not a new payment, while the attempt is processing", () => {
    const onCheckStatus = vi.fn();
    const view = section({
      model: model({ action: "checkStatus", status: "processing", paymentId: ID }),
      onCheckStatus,
    });
    const found = buttons(view);
    expect(found).toHaveLength(1);
    (found[0]?.props["onClick"] as () => void)();
    expect(onCheckStatus).toHaveBeenCalledExactlyOnceWith(ID);
    expect(html(view)).not.toContain("§payment.pay<");
    expect(html(view)).not.toContain("§payment.intro");
  });

  it.each([
    ["waiting", null],
    ["processing", null],
    ["paid", null],
    ["failed", "declined"],
    ["failed", "technical"],
    ["failed", "not_accepted"],
    ["expired", "expired"],
  ] as [ShopperPaymentStatus, ShopperPaymentFailureCategory | null][])(
    "says the status %s (%s) in words",
    (status, failureCategory) => {
      const markup = html(section({ model: model({ action: "none", status, failureCategory }) }));
      expect(markup).toContain(`§payment.status.${status}`);
      if (failureCategory !== null) expect(markup).toContain(`§payment.failure.${failureCategory}`);
      expect(
        buttons(section({ model: model({ action: "none", status, failureCategory }) })),
      ).toHaveLength(0);
    },
  );

  it("relabels the button 'Pay again' after a failed attempt", () => {
    const markup = html(
      section({ model: model({ status: "failed", failureCategory: "declined" }) }),
    );
    expect(markup).toContain("§payment.payAgain");
    expect(markup).not.toContain("§payment.pay<");
  });

  it("puts a refused start in an alert inside the focus target, once, and not the old failure text beside it", () => {
    const view = section({
      model: model({ status: "failed", failureCategory: "declined" }),
      pay: failed({ outcome: { kind: "notPayable", attempt: "clear" } }),
    });
    const markup = html(view);
    expect(markup).toContain(`id="${PAYMENT_FOCUS_IDS.message}"`);
    expect(markup).toMatch(new RegExp(`id="${PAYMENT_FOCUS_IDS.message}"[^>]*tabindex="-1"`));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("§payment.error.notPayable");
    expect(markup).not.toContain("§payment.failure.declined");
  });

  it("renders the focus target even before anything happened, so the focus can land there", () => {
    expect(html(section())).toContain(`id="${PAYMENT_FOCUS_IDS.message}"`);
  });

  it("renders a polite status region from the start (a region that appears with its text is often not read)", () => {
    const markup = html(section());
    expect(markup).toMatch(/<p role="status" aria-live="polite" aria-atomic="true"/);
  });

  it("after a lost provider answer shows the countdown, disables the check until it ends, and announces only the end", () => {
    const pay = failed({
      outcome: {
        kind: "providerUnavailable",
        attempt: "keep",
        canRetry: false,
        waitSeconds: 40,
        paymentId: ID,
      },
      waitUntil: 40_000,
    });
    const during = section({ pay, now: 10_000 });
    const markup = html(during);
    expect(markup).toContain("§payment.wait:30");
    expect(markup).toContain("§payment.error.providerWait");
    const [check] = buttons(during);
    expect(check?.props["disabled"]).toBe(true);
    expect(markup).toContain('aria-describedby="order-payment-wait"');
    // The countdown is a plain paragraph: the live region says nothing until the wait is over.
    expect(markup).not.toMatch(/aria-live="polite"[^>]*>[^<]*§payment\.wait/);
    // Not a new payment: a lost answer can only be checked.
    expect(markup).not.toContain("§payment.pay<");

    const after = section({ pay, now: 41_000 });
    expect(buttons(after)[0]?.props["disabled"]).toBe(false);
    expect(html(after)).toMatch(/aria-live="polite"[^>]*>[^<]*§payment\.wait\.done/);
  });

  it("after a refused create (canRetry true) keeps Pay again, disabled for the Retry-After seconds", () => {
    const pay = failed({
      outcome: {
        kind: "providerUnavailable",
        attempt: "clear",
        canRetry: true,
        waitSeconds: 30,
        paymentId: ID,
      },
      waitUntil: 30_000,
    });
    const during = section({ pay, now: 0 });
    expect(buttons(during)[0]?.props["disabled"]).toBe(true);
    expect(html(during)).toContain("§payment.error.providerRetry");
    expect(buttons(section({ pay, now: 31_000 }))[0]?.props["disabled"]).toBe(false);
  });

  it("switches to the status check after a processing answer", () => {
    const view = section({
      pay: failed({ outcome: { kind: "processing", attempt: "clear", paymentId: ID } }),
    });
    expect(html(view)).toContain("§payment.checkStatus");
    expect(html(view)).not.toContain("§payment.pay<");
  });

  it("disables the button and explains an insecure context; warns when the hand-off could not be saved", () => {
    const view = section({ pay: { ...initialPayState, insecure: true, returnSaved: false } });
    expect(buttons(view)[0]?.props["disabled"]).toBe(true);
    expect(html(view)).toContain("§payment.error.insecureContext");
    expect(html(view)).toContain("§payment.error.storage");
  });

  it("has no hardcoded words in any state, and every key exists in uk and en", () => {
    const baseProps: PaymentSectionViewProps = {
      t,
      locale: "uk",
      model: model(),
      orderExpiresAt: "2026-10-29T12:00:00.000Z",
      pay: initialPayState,
      now: 0,
      onPay: vi.fn(),
      onContinue: vi.fn(),
      onCheckStatus: vi.fn(),
    };
    const states: PaymentSectionViewProps[] = [];
    for (const status of ["waiting", "processing", "paid", "failed", "expired"] as const) {
      states.push({
        t,
        locale: "uk",
        model: model({
          action: "none",
          status,
          failureCategory: status === "failed" ? "declined" : null,
          expiresAt: "2026-10-29T12:00:00.000Z",
        }),
        orderExpiresAt: "2026-10-29T12:00:00.000Z",
        pay: initialPayState,
        now: 0,
        onPay: vi.fn(),
        onContinue: vi.fn(),
        onCheckStatus: vi.fn(),
      });
    }
    const outcomes: PayState[] = [
      failed({ outcome: { kind: "noPage", attempt: "clear" } }),
      failed({ outcome: { kind: "paymentInProgress", attempt: "clear" } }),
      failed({ outcome: { kind: "unavailable", attempt: "clear" } }),
      failed({ outcome: { kind: "keyReused", attempt: "clear" } }),
      failed({
        outcome: {
          kind: "providerUnavailable",
          attempt: "keep",
          canRetry: false,
          waitSeconds: 5,
          paymentId: ID,
        },
        waitUntil: 5_000,
      }),
      { ...initialPayState, phase: "pending" },
      { ...initialPayState, phase: "redirecting" },
    ];
    for (const pay of outcomes) states.push({ ...baseProps, model: model(), pay, now: 0 });
    for (const props of states) {
      const markup = html(PaymentSectionView(props));
      expect(leftoverText(markup), markup).toBe("");
      expect(textAttributes(markup)).toEqual([]);
    }
    for (const locale of locales) {
      const real = createTranslator(messagesByLocale[locale], locale);
      for (const pay of outcomes) {
        const markup = html(
          PaymentSectionView({ ...baseProps, t: real, locale, model: model(), pay }),
        );
        expect(markup, `${locale}`).not.toMatch(/\{[A-Za-z]+\}/);
      }
    }
  });
});

describe("payOutcomeText", () => {
  it("has a message for every outcome kind that can reach the shopper, in both locales", () => {
    const kinds = [
      { kind: "noPage", attempt: "clear" },
      { kind: "processing", attempt: "clear", paymentId: ID },
      { kind: "paymentInProgress", attempt: "clear" },
      { kind: "notPayable", attempt: "clear" },
      { kind: "unavailable", attempt: "clear" },
      {
        kind: "providerUnavailable",
        attempt: "clear",
        canRetry: true,
        waitSeconds: 3,
        paymentId: ID,
      },
      {
        kind: "providerUnavailable",
        attempt: "keep",
        canRetry: false,
        waitSeconds: 3,
        paymentId: ID,
      },
      { kind: "keyReused", attempt: "clear" },
      { kind: "signedOut", attempt: "clear" },
      { kind: "notFound", attempt: "clear" },
    ] as const;
    for (const locale of locales) {
      const real = createTranslator(messagesByLocale[locale], locale);
      for (const outcome of kinds) {
        expect(payOutcomeText(real, outcome), `${locale} ${outcome.kind}`).toBeTruthy();
      }
    }
  });

  it("never shows the API's English detail", () => {
    const real = createTranslator(messagesByLocale.en, "en");
    const text = payOutcomeText(real, {
      kind: "failed",
      attempt: "keep",
      failure: {
        messageKey: "errors.rule_violation",
        status: 409,
        code: "rule_violation",
        retryAfterSeconds: null,
        fieldErrors: [],
      },
    });
    expect(text).toBe(messagesByLocale.en["errors.rule_violation"]);
  });
});

// ------------------------------------------------------------------ the return page

const guestEntry: PaymentReturn = {
  kind: "guest",
  number: "7K3M-9QX2",
  accessToken: TOKEN,
  paymentId: ID,
};
const accountEntry: PaymentReturn = { kind: "account", number: "7K3M-9QX2", paymentId: ID };

function paymentState(
  status: ShopperPaymentStatus,
  over: Partial<PaymentState> = {},
): PaymentState {
  return {
    paymentId: ID,
    status,
    failureCategory: null,
    expiresAt: "2026-10-29T12:00:00.000Z",
    orderStatus: "awaiting_payment",
    canRetry: false,
    ...over,
  };
}

const failure = {
  messageKey: "errors.network",
  status: null,
  code: null,
  retryAfterSeconds: null,
  fieldErrors: [],
};

const returnStates: [string, PaymentWatchState | "noEntry", PaymentReturn | null][] = [
  ["loading", { phase: "loading" }, guestEntry],
  ["resolving", { phase: "loading" }, null],
  ["waiting", { phase: "watching", payment: paymentState("waiting") }, guestEntry],
  ["processing", { phase: "watching", payment: paymentState("processing") }, guestEntry],
  ["paid", { phase: "final", payment: paymentState("paid", { orderStatus: "paid" }) }, guestEntry],
  [
    "failed",
    {
      phase: "final",
      payment: paymentState("failed", { failureCategory: "declined", canRetry: true }),
    },
    guestEntry,
  ],
  [
    "expired",
    { phase: "final", payment: paymentState("expired", { failureCategory: "expired" }) },
    accountEntry,
  ],
  ["timedOut", { phase: "timedOut", payment: paymentState("processing") }, guestEntry],
  ["error", { phase: "error", failure, last: null }, guestEntry],
  ["notFound", { phase: "notFound" }, guestEntry],
  ["signedOut", { phase: "signedOut" }, accountEntry],
  ["noEntry", "noEntry", null],
];

function returnView(
  state: PaymentWatchState | "noEntry",
  entry: PaymentReturn | null,
  onCheckAgain = vi.fn(),
) {
  return PaymentReturnView({ t, locale: "uk", state, entry, onCheckAgain });
}

describe("PaymentReturnView", () => {
  it.each(returnStates)(
    "%s: one h1, one polite live result region with a fixed id and a reserved height",
    (_name, state, entry) => {
      const markup = renderToStaticMarkup(returnView(state, entry));
      expect(markup.match(/<h1[ >]/g)).toHaveLength(1);
      expect(markup).toContain("§payment.return.title");
      expect(markup.match(new RegExp(`id="${RETURN_RESULT_ID}"`, "g"))).toHaveLength(1);
      expect(markup).toMatch(
        new RegExp(
          `id="${RETURN_RESULT_ID}"[^>]*role="status"|role="status"[^>]*id="${RETURN_RESULT_ID}"`,
        ),
      );
      expect(markup).toContain('aria-live="polite"');
      expect(markup).toContain('tabindex="-1"');
      // The result box keeps its height in every state: the page does not jump when the state changes.
      expect(markup).toContain("min-h-48");
      // No second live role inside the region (an alert would announce twice).
      expect(markup).not.toContain('role="alert"');
    },
  );

  it("is busy (aria-busy, a spinner that is hidden from assistive technology) only while it is reading", () => {
    const busy = renderToStaticMarkup(
      returnView({ phase: "watching", payment: paymentState("waiting") }, guestEntry),
    );
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('aria-hidden="true"');
    const done = renderToStaticMarkup(
      returnView({ phase: "final", payment: paymentState("paid") }, guestEntry),
    );
    expect(done).toContain('aria-busy="false"');
    expect(done).not.toContain("animate-spin");
  });

  it("shows only what the API answered: the status, the failure reason and the order status", () => {
    const markup = renderToStaticMarkup(
      returnView(
        {
          phase: "final",
          payment: paymentState("failed", {
            failureCategory: "declined",
            orderStatus: "awaiting_payment",
          }),
        },
        guestEntry,
      ),
    );
    expect(markup).toContain("§payment.return.failed.title");
    expect(markup).toContain("§payment.failure.declined");
    expect(markup).toContain("§payment.return.orderStatus");
    const real = createTranslator(messagesByLocale.en, "en");
    const text = renderToStaticMarkup(
      PaymentReturnView({
        t: real,
        locale: "en",
        state: { phase: "final", payment: paymentState("failed", { failureCategory: "declined" }) },
        entry: guestEntry,
        onCheckAgain: vi.fn(),
      }),
    );
    expect(text).toContain("Order status: Awaiting payment");
    expect(text).toContain("Order 7K3M-9QX2");
  });

  it("links a guest back to the order with the token in the fragment, and a customer to the account order", () => {
    const guest = renderToStaticMarkup(
      returnView({ phase: "final", payment: paymentState("paid") }, guestEntry),
    );
    expect(guest).toContain(`href="/uk/order/7K3M-9QX2#t=${TOKEN}"`);
    const account = renderToStaticMarkup(
      returnView({ phase: "final", payment: paymentState("paid") }, accountEntry),
    );
    expect(account).toContain('href="/uk/account/orders/7K3M-9QX2"');
    expect(account).not.toContain("#t=");
  });

  it("offers 'Check again' as a button that calls the handler (timed out, error), plus the way back", () => {
    for (const state of [
      { phase: "timedOut", payment: paymentState("processing") },
      { phase: "error", failure, last: null },
    ] as PaymentWatchState[]) {
      const onCheckAgain = vi.fn();
      const root = returnView(state, guestEntry, onCheckAgain);
      const found = findElements(root, (el) => el.type === Button);
      expect(found).toHaveLength(1);
      (found[0]?.props["onClick"] as () => void)();
      expect(onCheckAgain).toHaveBeenCalledTimes(1);
      expect(renderToStaticMarkup(root)).toContain("§payment.return.backToOrder");
    }
  });

  it("tells a visitor without a hand-off to open the order, with links that need no hand-off", () => {
    const markup = renderToStaticMarkup(returnView("noEntry", null));
    expect(markup).toContain("§payment.return.noEntry.title");
    expect(markup).toContain('href="/uk/account/orders"');
    expect(markup).toContain('href="/uk"');
    expect(markup).not.toContain("§payment.return.order<");
  });

  it("sends a signed-out customer to the sign-in page, coming back to the order", () => {
    const markup = renderToStaticMarkup(returnView({ phase: "signedOut" }, accountEntry));
    expect(markup).toContain('href="/uk/account/login?next=%2Fuk%2Faccount%2Forders%2F7K3M-9QX2"');
  });

  it("has no hardcoded words in any state, and no unfilled placeholder in uk and en", () => {
    for (const [name, state, entry] of returnStates) {
      const markup = renderToStaticMarkup(returnView(state, entry));
      // The order number is data.
      expect(leftoverText(markup.replace("7K3M-9QX2", "")), name).toBe("");
      expect(textAttributes(markup), name).toEqual([]);
      for (const locale of locales) {
        const real = createTranslator(messagesByLocale[locale], locale);
        const text = renderToStaticMarkup(
          PaymentReturnView({ t: real, locale, state, entry, onCheckAgain: vi.fn() }),
        );
        expect(text, `${locale} ${name}`).not.toMatch(/\{[A-Za-z]+\}|§/);
      }
    }
  });

  it("always offers a way out and the contact hint, so no state is a dead end", () => {
    for (const [name, state, entry] of returnStates) {
      const markup = renderToStaticMarkup(returnView(state, entry));
      expect(markup, name).toContain("§payment.return.contact");
    }
  });
});

describe("OrderDetailsView with a payment section", () => {
  const order: Order = {
    number: "7K3M-9QX2",
    status: "awaiting_payment",
    placedAt: "2026-10-19T10:00:00.000Z",
    expiresAt: "2026-10-19T10:30:00.000Z",
    currency: "UAH",
    items: [],
    subtotal: { amount: 100, currency: "UAH" },
    shippingTotal: { amount: 0, currency: "UAH" },
    discountTotal: { amount: 0, currency: "UAH" },
    taxTotal: { amount: 0, currency: "UAH" },
    total: { amount: 100, currency: "UAH" },
    adjustments: [],
    contact: { email: "§e", phone: "§p", firstName: "§f", lastName: "§l" },
    shippingAddress: null,
    billingAddress: null,
    shipping: null,
    shipments: [],
    history: [],
    payment: { canPay: true, providers: ["fake"], latest: null },
  };

  function details(payment: React.ReactNode) {
    return renderToStaticMarkup(
      OrderDetailsView({
        order,
        t,
        locale: "uk",
        shop: { currency: "UAH", exponent: 2 },
        cancel: { confirming: false, pending: false, failure: null, done: false },
        onAskCancel: vi.fn(),
        onKeepOrder: vi.fn(),
        onConfirmCancel: vi.fn(),
        ...(payment === undefined ? {} : { payment }),
      }),
    );
  }

  it("shows the section instead of the 'the shop will contact you' wording", () => {
    const markup = details(<p>§slot</p>);
    expect(markup).toContain("§slot");
    expect(markup).not.toContain("§order.payment.awaiting");
  });

  it("keeps the neutral wording when the page gives no section", () => {
    expect(details(null)).toContain("§order.payment.awaiting");
    expect(details(undefined)).toContain("§order.payment.awaiting");
  });
});
