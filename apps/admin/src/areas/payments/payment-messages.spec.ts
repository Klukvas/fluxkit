import { describe, expect, it } from "vitest";
import { messagesForArea } from "../../test-helpers";
import { MESSAGE_FILES as ORDERS_FILES } from "../orders/index";
import { MESSAGE_FILES } from "./index";
import { PAYMENT_REFUSAL_RULES } from "./payment-outcome";
import {
  PAYMENT_ATTENTION_CODES,
  PAYMENT_CREATORS,
  PAYMENT_EVENT_SOURCES,
  PAYMENT_ORDER_OUTCOMES,
  PAYMENT_STATUS_LIST,
  REFUND_REASON_LIST,
  REFUND_STATUS_LIST,
} from "./payment-view";

/** Message keys the payment panel builds from data (the messages spec only sees literal keys). */
const BUILT_KEYS = [
  ...PAYMENT_STATUS_LIST.map((status) => `payment.status.${status}`),
  ...REFUND_STATUS_LIST.map((status) => `payment.refundStatus.${status}`),
  ...REFUND_STATUS_LIST.flatMap((status) => [
    `payment.notice.refund.${status}`,
    `payment.notice.refund.${status}.title`,
  ]),
  ...REFUND_REASON_LIST.map((reason) => `payment.refundReason.${reason}`),
  ...PAYMENT_EVENT_SOURCES.map((source) => `payment.source.${source}`),
  ...PAYMENT_ORDER_OUTCOMES.map((outcome) => `payment.outcome.${outcome}`),
  ...PAYMENT_CREATORS.map((creator) => `payment.createdBy.${creator}`),
  ...[...PAYMENT_ATTENTION_CODES, "unknown"].flatMap((code) => [
    `payment.attention.code.${code}`,
    `payment.attention.help.${code}`,
  ]),
  ...PAYMENT_REFUSAL_RULES.map((rule) => `payment.refusal.${rule}`),
  ...["invalid_amount", "currency_mismatch"].map((code) => `payment.fieldError.${code}`),
  ...[
    "empty",
    "comma_separator",
    "inner_space",
    "invalid_format",
    "too_many_decimals",
    "negative_zero",
    "negative_amount",
    "amount_out_of_range",
    "not_positive",
    "exceeds_remaining",
  ].map((issue) => `payment.refund.amountIssue.${issue}`),
  ...["required", "too_long", "invalid_characters"].map(
    (issue) => `payment.refund.noteIssue.${issue}`,
  ),
];

describe("payment messages built from data", () => {
  it("exist in uk and en within the files the payments area and the orders area load", async () => {
    expect(MESSAGE_FILES).toContain("payments");
    expect(ORDERS_FILES).toContain("payments");
    for (const locale of ["uk", "en"] as const) {
      const messages = await messagesForArea(locale, MESSAGE_FILES);
      const ordersView = await messagesForArea(locale, ORDERS_FILES);
      for (const key of BUILT_KEYS) {
        expect(key in messages, `${locale} payments area: ${key}`).toBe(true);
        expect(key in ordersView, `${locale} orders area: ${key}`).toBe(true);
      }
    }
  });
});
