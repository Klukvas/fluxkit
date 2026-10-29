import type { AdminConfig, AdminPayment } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { createTranslator, type Translator } from "@fluxkit/ui";
import { beforeAll, describe, expect, it } from "vitest";
import { formatDateTime, formatMoney } from "../../lib/format";
import {
  leftoverText,
  messagesForArea,
  paymentFixture,
  refundFixture,
  renderInRouter,
  sentinelTranslator,
} from "../../test-helpers";
import { StatusLine } from "../orders/order-parts";
import { AttentionMore, AttentionTable } from "./attention-view";
import type { AttentionList } from "./attention-list";
import { ClearAttentionDialog, RefundDialog, type RefundDialogProps } from "./payment-dialogs";
import { MESSAGE_FILES } from "./index";
import type { PaymentNotice } from "./payment-outcome";
import { PaymentNoticeView, PaymentPanel } from "./payment-panel";
import { offeredPaymentActions } from "./payment-view";

const sentinel = sentinelTranslator();
/** Money as the screens write it (Intl puts a no-break space after the currency). */
const U = (amount: number) => formatMoney({ amount, currency: "UAH" }, 2, "en");
const noop = () => undefined;
const OWNER = [...ROLE_PERMISSIONS.owner];
const MANAGER = [...ROLE_PERMISSIONS.manager];
const ME = "11111111-1111-4111-8111-111111111111";
const config: AdminConfig = {
  defaultLocale: "uk",
  locales: ["uk", "en"],
  shopCurrency: "UAH",
  currencyExponent: 2,
  supportedCurrencies: [{ code: "UAH", exponent: 2 }],
  pricesIncludeTax: true,
  lowStockThreshold: 5,
  emailDelivery: false,
  onlinePayment: true,
  search: false,
  media: { uploadsEnabled: true, maxBytes: 1, contentTypes: [] },
};
const money = { locale: "en", config };

let en: Translator;
let uk: Translator;
beforeAll(async () => {
  en = createTranslator(await messagesForArea("en", MESSAGE_FILES), "en");
  uk = createTranslator(await messagesForArea("uk", MESSAGE_FILES), "uk");
});

/** The `disabled` attribute itself: the class list of every `Button` holds `disabled:opacity-50`, which proves nothing. */
const hasDisabledAttribute = (tag: string): boolean => /\sdisabled=""/.test(tag);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function withoutData(html: string, data: readonly string[]): string {
  return data.reduce((rest, text) => rest.split(escapeHtml(text)).join(" "), html);
}

function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
}

const FULL = paymentFixture({
  needsAttention: true,
  attentionCode: "refund_failed",
  refunds: [
    refundFixture({ status: "succeeded" }),
    refundFixture({
      id: "44444444-4444-4444-8444-444444444444",
      status: "failed",
      failureCode: "refund_declined",
      note: "<script>alert(1)</script>",
      actorAdminId: null,
      reason: "late_payment",
    }),
  ],
  refundedAmount: { amount: 5000, currency: "UAH" },
  refundableAmount: { amount: 13900, currency: "UAH" },
  history: [
    {
      source: "webhook",
      fromStatus: "processing",
      toStatus: "succeeded",
      providerStatus: "success",
      providerModifiedAt: "2026-10-29T10:01:00.000Z",
      applied: true,
      failureCode: null,
      actorAdminId: null,
      action: null,
      at: "2026-10-29T10:01:00.000Z",
    },
    {
      source: "admin",
      fromStatus: null,
      toStatus: null,
      providerStatus: null,
      providerModifiedAt: null,
      applied: true,
      failureCode: null,
      actorAdminId: ME,
      action: "attention_cleared",
      at: "2026-10-29T12:00:00.000Z",
    },
  ],
});

function panel(
  payments: readonly AdminPayment[],
  permissions: readonly string[] | null,
  t: Translator = sentinel,
  busy = false,
): string {
  return renderInRouter(
    <PaymentPanel
      t={t}
      uiLocale="en"
      money={money}
      payments={payments}
      actionsFor={(payment) => offeredPaymentActions(payment, permissions)}
      onAction={noop}
      busy={busy}
      meId={ME}
      emails={null}
      statusLine={<StatusLine />}
    />,
    "/orders/o1",
  );
}

describe("the payment panel", () => {
  it("shows the empty state for an order without attempts, with a heading and no table", () => {
    const html = panel([], OWNER);
    expect(html).toContain('aria-labelledby="order-payments"');
    expect(html).toContain("§payment.none");
    expect(html).not.toContain("<table");
    expect(buttons(html)).toHaveLength(0);
  });

  it("has no hardcoded words: everything but data goes through the translator", () => {
    const html = panel(
      [FULL, paymentFixture({ id: "other", status: "create_unknown", providerPaymentId: null })],
      OWNER,
    );
    const left = leftoverText(
      withoutData(html, [
        "fake",
        "refund_declined",
        "Damaged item",
        "<script>alert(1)</script>",
        U(18900),
        U(5000),
        U(13900),
        formatDateTime("2026-10-29T10:00:00.000Z", "en"),
        formatDateTime("2026-10-29T10:01:00.000Z", "en"),
        formatDateTime("2026-10-29T11:00:00.000Z", "en"),
        formatDateTime("2026-10-29T12:00:00.000Z", "en"),
      ]),
    );
    expect(left).toBe("");
  });

  it("shows the attempt's status, amounts, provider, card (system and last 4 only), refunds and journal", () => {
    const html = panel([FULL], OWNER, en);
    expect(html).toContain("Paid");
    expect(html).toContain(U(18900));
    expect(html).toContain(U(13900));
    expect(html).toContain("visa ending 4242");
    expect(html).toContain("Refunded");
    expect(html).toContain("Refused");
    expect(html).toContain("refund_declined");
    expect(html).toContain("Journal (2)");
    expect(html).toContain("Attention item closed");
    // Never the page URL, ids of the provider's invoice, or anything but the last four digits of the card.
    expect(html).not.toContain("fake-invoice-1");
    expect(html).not.toMatch(/\b\d{13,19}\b/);
  });

  it("renders a refund note as text, never as markup", () => {
    const html = panel([FULL], OWNER);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shows the attention banner with the translated code and what to do", () => {
    const html = panel([FULL], OWNER, en);
    expect(html).toContain("This payment needs your attention");
    expect(html).toContain("A refund was refused");
    expect(html).toContain("The provider refused a refund.");
    expect(html).not.toContain(">refund_failed<");
  });

  it("says a cleared item was closed, without the banner", () => {
    const html = panel(
      [paymentFixture({ needsAttention: false, attentionCode: "late_payment" })],
      OWNER,
      en,
    );
    expect(html).not.toContain("This payment needs your attention");
    expect(html).toContain(
      "An earlier attention item was closed: Paid after the order could no longer be paid.",
    );
  });

  it("explains an attempt whose creation got no answer", () => {
    const html = panel(
      [paymentFixture({ status: "create_unknown", providerPaymentId: null })],
      OWNER,
      en,
    );
    expect(html).toContain("The provider did not answer");
    expect(html).toContain("Provider did not answer");
  });

  it("says in the Ukrainian words too", () => {
    const html = panel([FULL], OWNER, uk);
    expect(html).toContain("Оплачено");
    expect(html).toContain("Повернути кошти");
    expect(html).toContain("Журнал");
  });

  it("offers the owner and the manager Refund, Check status and Close attention item", () => {
    for (const permissions of [OWNER, MANAGER]) {
      const html = panel([FULL], permissions, en);
      const labels = buttons(html).map((button) => button.replace(/<[^>]*>/g, ""));
      expect(labels).toEqual(["Refund", "Check status", "Close attention item"]);
    }
  });

  it("offers a session that only reads orders no button at all (no refund, no check, no close)", () => {
    const html = panel([FULL], ["orders.read"], en);
    expect(buttons(html)).toHaveLength(0);
    expect(html).toContain(U(18900));
  });

  it("offers Check status without Refund to orders.write alone, and Refund without Check status to payments.refund alone", () => {
    const write = buttons(panel([FULL], ["orders.read", "orders.write"], en)).map((b) =>
      b.replace(/<[^>]*>/g, ""),
    );
    expect(write).toEqual(["Check status"]);
    const refund = buttons(panel([FULL], ["orders.read", "payments.refund"], en)).map((b) =>
      b.replace(/<[^>]*>/g, ""),
    );
    expect(refund).toEqual(["Refund", "Close attention item"]);
  });

  it("turns every action off while a write runs", () => {
    const html = panel([FULL], OWNER, en, true);
    for (const button of buttons(html)) expect(hasDisabledAttribute(button), button).toBe(true);
  });

  it("hides Refund for a payment with nothing left to refund", () => {
    const refunded = paymentFixture({
      refundedAmount: { amount: 18900, currency: "UAH" },
      refundableAmount: { amount: 0, currency: "UAH" },
    });
    const labels = buttons(panel([refunded], OWNER, en)).map((b) => b.replace(/<[^>]*>/g, ""));
    expect(labels).toEqual(["Check status"]);
  });

  it("warns that a requested or unknown refund is waiting and is never sent twice", () => {
    const waiting = paymentFixture({ refunds: [refundFixture({ status: "unknown" })] });
    expect(panel([waiting], OWNER, en)).toContain("never sent twice");
    expect(panel([paymentFixture()], OWNER, en)).not.toContain("never sent twice");
  });
});

describe("the status line after an action", () => {
  function notice(value: PaymentNotice | null, t: Translator = en): string {
    return renderInRouter(<PaymentNoticeView t={t} uiLocale="en" money={money} notice={value} />);
  }
  const amount = { amount: 5000, currency: "UAH" };

  it("says nothing without a notice", () => {
    expect(notice(null)).toBe("");
  });

  it("states each refund result honestly", () => {
    expect(
      notice({ kind: "refund", status: "succeeded", amount, failureCode: null, replay: false }),
    ).toContain(`${U(5000)} was refunded`);
    expect(
      notice({ kind: "refund", status: "processing", amount, failureCode: null, replay: false }),
    ).toContain("is processing it");
    expect(
      notice({ kind: "refund", status: "requested", amount, failureCode: null, replay: false }),
    ).toContain("was not sent to the provider yet");
    const failed = notice({
      kind: "refund",
      status: "failed",
      amount,
      failureCode: "refund_declined",
      replay: false,
    });
    expect(failed).toContain("refused the refund");
    expect(failed).toContain("refund_declined");
  });

  it("says an unknown result is unknown, not done, and tells the admin not to refund again", () => {
    const html = notice({
      kind: "refund",
      status: "unknown",
      amount,
      failureCode: null,
      replay: false,
    });
    expect(html).toContain("result unknown");
    expect(html).toContain("not known whether the money moved");
    expect(html).toContain("do not refund this amount a second time");
    expect(html).not.toContain("was refunded");
    expect(html).not.toContain("alert-success");
  });

  it("says a replay was not sent again", () => {
    expect(
      notice({ kind: "refund", status: "succeeded", amount, failureCode: null, replay: true }),
    ).toContain("nothing was sent again");
  });

  it("shows when the status was checked", () => {
    const at = "2026-10-29T12:34:00.000Z";
    expect(notice({ kind: "resynced", at })).toContain(
      `Checked with the provider at ${formatDateTime(at, "en")}.`,
    );
  });

  it("explains a lost answer of each write without promising anything", () => {
    for (const kind of ["refundLost", "resyncLost", "clearLost"] as const) {
      const html = notice({ kind });
      expect(html).toContain("No answer");
      expect(html).toContain("No answer came");
    }
    expect(notice({ kind: "cleared" })).toContain("closed");
  });

  it("has no hardcoded words", () => {
    for (const value of [
      { kind: "refund", status: "unknown", amount, failureCode: "x", replay: true },
      { kind: "refundLost" },
      { kind: "resynced", at: "2026-10-29T12:34:00.000Z" },
      { kind: "cleared" },
    ] as PaymentNotice[]) {
      const left = leftoverText(
        withoutData(notice(value, sentinel), [
          U(5000),
          "x",
          formatDateTime("2026-10-29T12:34:00.000Z", "en"),
        ]),
      );
      expect(left).toBe("");
    }
  });
});

describe("the refund dialog", () => {
  function props(overrides: Partial<RefundDialogProps> = {}): RefundDialogProps {
    return {
      t: en,
      open: true,
      step: "form",
      orderNumber: "7K3M-9QX2",
      payment: paymentFixture({
        refundedAmount: { amount: 5000, currency: "UAH" },
        refundableAmount: { amount: 13900, currency: "UAH" },
      }),
      money,
      currency: "UAH",
      exponent: 2,
      values: { amount: "139.00", note: "" },
      onChange: noop,
      amountIssue: null,
      noteIssue: null,
      amountError: null,
      noteError: null,
      error: null,
      retrying: false,
      confirmAmountText: U(13900),
      busy: false,
      onReview: noop,
      onBack: noop,
      onConfirm: noop,
      onClose: noop,
      ...overrides,
    };
  }
  const render = (p: RefundDialogProps) => renderInRouter(<RefundDialog {...p} />);

  it("starts with the amount field holding the remaining amount, labelled, with a note field", () => {
    const html = render(props());
    expect(html).toMatch(/<input[^>]*id="payment-refund-amount"[^>]*value="139.00"/);
    expect(html).toContain('for="payment-refund-amount"');
    expect(html).toContain("Amount to refund (UAH)");
    expect(html).toMatch(/<textarea[^>]*id="payment-refund-note"/);
    expect(html).toContain('for="payment-refund-note"');
    expect(html).toContain(`Up to ${U(13900)}`);
    expect(html).toContain("Review refund");
    expect(html).not.toContain('role="alertdialog"');
  });

  it("shows what was paid, what was refunded and what is left", () => {
    const html = render(props());
    expect(html).toContain(U(18900));
    expect(html).toContain(U(5000));
    expect(html).toContain(U(13900));
  });

  it("ties a field error to its field and marks it invalid", () => {
    const html = render(props({ amountIssue: "exceeds_remaining", noteIssue: "required" }));
    expect(html).toMatch(/<input[^>]*id="payment-refund-amount"[^>]*aria-invalid="true"/);
    expect(html).toContain('id="payment-refund-amount-error"');
    expect(html).toContain(`At most ${U(13900)} can still be refunded.`);
    expect(html).toMatch(/<textarea[^>]*id="payment-refund-note"[^>]*aria-invalid="true"/);
    expect(html).toContain("Give a reason.");
  });

  it("shows an error of the API on its field, and a refusal on top", () => {
    const html = render(
      props({
        amountError: { key: "payment.fieldError.currency_mismatch" },
        error: { key: "payment.refusal.refund_exceeds_remaining" },
      }),
    );
    expect(html).toContain("The amount is not in the payment&#x27;s currency.");
    expect(html).toContain("more than can still be refunded");
  });

  it("is a confirmation on the second step: the amount, the reason, a warning, Back first (the safe choice) and Refund last", () => {
    const html = render(
      props({ step: "confirm", values: { amount: "139.00", note: "Damaged <b>box</b>" } }),
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("This cannot be undone");
    expect(html).toContain(`You are about to refund ${U(13900)} (UAH)`);
    expect(html).toContain("Damaged &lt;b&gt;box&lt;/b&gt;");
    expect(html).not.toContain('id="payment-refund-amount"');
    const labels = buttons(html).map((b) => b.replace(/<[^>]*>/g, ""));
    expect(labels).toEqual(["Back", `Refund ${U(13900)}`]);
    expect(buttons(html)[0]).toContain('data-autofocus=""');
  });

  it("turns every button and field off while the write runs", () => {
    const form = render(props({ busy: true }));
    for (const button of buttons(form)) expect(hasDisabledAttribute(button), button).toBe(true);
    expect(tag(form, "input", "amount")).toMatch(/\sdisabled=""/);
    const confirm = render(props({ step: "confirm", busy: true }));
    for (const button of buttons(confirm)) expect(hasDisabledAttribute(button), button).toBe(true);
    expect(confirm).toContain("Sending…");
  });

  it("tells the admin that a retry after a lost answer is the same request", () => {
    expect(render(props({ retrying: true }))).toContain("cannot refund twice");
    expect(render(props())).not.toContain("cannot refund twice");
  });

  it("has no hardcoded words on either step", () => {
    for (const step of ["form", "confirm"] as const) {
      const left = leftoverText(
        withoutData(render(props({ t: sentinel, step, retrying: true, amountIssue: "empty" })), [
          U(18900),
          U(5000),
          U(13900),
          "139.00",
          "UAH",
        ]),
      );
      expect(left).toBe("");
    }
  });
});

function tag(html: string, element: string, name: string): string {
  const found = [...html.matchAll(new RegExp(`<${element}[^>]*>`, "g"))]
    .map((match) => match[0])
    .find((text) => text.includes(`name="${name}"`));
  if (found === undefined) throw new Error(`No <${element} name="${name}">`);
  return found;
}

describe("the close-attention dialog", () => {
  it("names the item, says nothing changes at the provider and has a safe choice first", () => {
    const html = renderInRouter(
      <ClearAttentionDialog
        t={en}
        payment={{ attentionCode: "late_payment" }}
        error={null}
        busy={false}
        onConfirm={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain("Close this attention item?");
    expect(html).toContain("Paid after the order could no longer be paid");
    expect(html).toContain("changes nothing at the provider");
    const labels = buttons(html).map((b) => b.replace(/<[^>]*>/g, ""));
    expect(labels).toEqual(["Keep open", "Close item"]);
  });
});

describe("the attention list", () => {
  const list: AttentionList = {
    rows: [
      {
        orderId: "0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f",
        orderNumber: "7K3M-9QX2",
        payment: paymentFixture({ needsAttention: true, attentionCode: "duplicate_payment" }),
      },
    ],
    nextCursor: "abc",
  };

  it("links each row to its order and names the reason in words", () => {
    const html = renderInRouter(<AttentionTable t={en} uiLocale="en" money={money} list={list} />);
    expect(html).toContain('href="/admin-ui/orders/0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f"');
    expect(html).toContain("Order 7K3M-9QX2");
    expect(html).toContain("Paid twice");
    expect(html).toContain(U(18900));
    expect(html).not.toContain(">duplicate_payment<");
  });

  it("shows an empty state", () => {
    const html = renderInRouter(
      <AttentionTable t={en} uiLocale="en" money={money} list={{ rows: [], nextCursor: null }} />,
    );
    expect(html).toContain("No payment needs attention.");
  });

  it("has no hardcoded words", () => {
    const html = renderInRouter(
      <AttentionTable t={sentinel} uiLocale="en" money={money} list={list} />,
    );
    expect(
      leftoverText(
        withoutData(html, [
          "fake",
          U(18900),
          "7K3M-9QX2",
          formatDateTime("2026-10-29T10:00:00.000Z", "en"),
        ]),
      ),
    ).toBe("");
  });

  it("offers Load more only while a next page exists, off while loading, with the failure of the last try", () => {
    const more = (hasMore: boolean, loading: boolean, error = false) =>
      renderInRouter(
        <AttentionMore
          t={en}
          count={20}
          hasMore={hasMore}
          loading={loading}
          error={error ? { key: "errors.network" } : null}
          onLoadMore={noop}
        />,
      );
    expect(more(true, false)).toContain("Load more");
    expect(more(true, false)).toContain("20 shown. There are more.");
    expect(more(false, false)).not.toContain("Load more");
    expect(more(false, false)).toContain("That is all of them.");
    const loading = more(true, true);
    expect(loading).toContain("Loading…");
    expect(hasDisabledAttribute(buttons(loading)[0] ?? "")).toBe(true);
    expect(more(true, false, true)).toContain('role="alert"');
  });
});
