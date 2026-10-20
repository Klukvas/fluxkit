import { ORDER_STATUSES } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { messagesForArea } from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { RESERVATION_STATUSES } from "./order-detail-view";
import { ORDER_ACTIONS } from "./order-actions";
import { ORDER_FIELD_ISSUES, ORDER_REFUSAL_RULES } from "./order-parts";

/** Message keys the orders area builds from data (the messages spec only sees literal keys). */
const BUILT_KEYS = [
  ...ORDER_STATUSES.map((status) => `order.status.${status}`),
  ...ORDER_REFUSAL_RULES.map((rule) => `order.refusal.${rule}`),
  ...ORDER_FIELD_ISSUES.map((issue) => `order.field.${issue}`),
  ...RESERVATION_STATUSES.map((status) => `order.reservation.${status}`),
  ...["invalid_day", "end_before_start", "out_of_range"].map(
    (reason) => `order.list.dateRange.${reason}`,
  ),
  ...["subtotal", "shipping", "discount", "tax", "total"].map((id) => `order.totals.${id}`),
  ...ORDER_ACTIONS.map((action) => `order.notice.done.${action}`),
  ...["markFulfilled", "cancel"].map((action) => `order.notice.unknown.${action}`),
  ...["recorded", "not_recorded", "paid_with_other_reference", "not_payable", "unreadable"].map(
    (check) => `order.notice.unknownPaid.${check}`,
  ),
];

describe("orders messages built from data", () => {
  it("exist in uk and en within the files the area loads", async () => {
    for (const locale of ["uk", "en"] as const) {
      const messages = await messagesForArea(locale, MESSAGE_FILES);
      for (const key of BUILT_KEYS) expect(key in messages, `${locale}: ${key}`).toBe(true);
    }
  });

  it("explain every order rule of the admin routes (docs/api/orders.md)", () => {
    expect([...ORDER_REFUSAL_RULES].sort()).toEqual(
      [
        "amount_mismatch",
        "awaiting_stock",
        "invalid_transition",
        "order_not_payable",
        "payment_reference_conflict",
      ].sort(),
    );
  });
});
