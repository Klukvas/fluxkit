import { describe, expect, it } from "vitest";
import { PRODUCT_EDITOR_TABS } from "../../layout/product-editor";
import { messagesForArea } from "../../test-helpers";
import { ATTRIBUTE_REASONS } from "./attribute-values-form";
import { EDITOR_NOTICE_KINDS } from "./editor-notice";
import { MESSAGE_FILES } from "./index";
import { OPTION_REASONS } from "./option-selection";
import { LIFECYCLE_ACTIONS, LIFECYCLE_CONFIRMATION } from "./lifecycle";
import { PRODUCT_STATUSES } from "./product-list-query";
import { statusLabelKey } from "./product-status";
import { PRICE_ISSUES } from "./prices/price-grid";
import { ADJUSTMENT_ISSUES, ADJUSTMENT_KINDS, modesFor } from "./stock/stock-adjustment";
import { RESERVATION_STATUSES } from "./stock/stock-tab";
import { STOCK_STATES } from "./stock/stock-view";

/** Every movement kind the journal can show (`sale` is written by orders). */
const MOVEMENT_KINDS = ["receipt", "adjustment", "sale", "return"] as const;
const ADJUSTMENT_CHECKS = ["new_by_you", "new_by_other", "none_new", "unreadable"] as const;

/**
 * Keys the products screens build from data (`products.tab.${id}`, `products.lifecycle.${action}`, ...), which the
 * generic "keys used in the source" test cannot see. Each family is checked in both languages, among the messages the
 * area loads, so a missing key is a test failure and not a thrown error in front of an admin.
 */
/** Every reason `deleteBlock`, `defaultBlock` and `activeToggle` can give, as the Variants tab names them. */
const VARIANT_HINTS = [
  "defaultNeedsActive",
  "default_variant_inactive",
  "no_active_variant",
  "product_not_draft",
  "default_variant",
  "last_variant",
] as const;

function expected(): string[] {
  const keys = [
    ...PRODUCT_EDITOR_TABS.map((tab) => tab.messageKey),
    ...LIFECYCLE_ACTIONS.map((action) => `products.lifecycle.${action}`),
    ...LIFECYCLE_ACTIONS.filter((action) => LIFECYCLE_CONFIRMATION[action] === "default").flatMap(
      (action) => [`products.lifecycle.${action}Title`, `products.lifecycle.${action}Body`],
    ),
    ...EDITOR_NOTICE_KINDS.filter((kind) => kind !== "unknown").map(
      (kind) => `products.notice.${kind}`,
    ),
    ...OPTION_REASONS.map((reason) => `products.optionReason.${reason}`),
    ...VARIANT_HINTS.map((hint) => `products.variants.hint.${hint}`),
    ...PRODUCT_STATUSES.map(statusLabelKey),
    ...ATTRIBUTE_REASONS.map((reason) => `products.attributeReason.${reason}`),
    ...PRICE_ISSUES.map((issue) => `products.prices.reason.${issue}`),
    ...ADJUSTMENT_ISSUES.map((issue) => `products.stock.issue.${issue}`),
    ...STOCK_STATES.map((state) => `products.stock.state.${state}`),
    ...MOVEMENT_KINDS.map((kind) => `products.stock.kindLabel.${kind}`),
    ...ADJUSTMENT_KINDS.map((kind) => `products.stock.kindHint.${kind}`),
    ...ADJUSTMENT_KINDS.flatMap(modesFor).map((mode) => `products.stock.modeLabel.${mode}`),
    ...RESERVATION_STATUSES.flatMap((status) => [
      `products.stock.reservation.${status}`,
      `products.stock.noReservations.${status}`,
    ]),
    ...ADJUSTMENT_CHECKS.map((check) => `products.stock.result.${check}`),
    ...(["onHand", "reserved", "available"] as const).map(
      (column) => `products.stock.column.${column}`,
    ),
  ];
  return keys;
}

describe("product message keys built from data", () => {
  it("exist in uk and en, among the messages the area loads", async () => {
    const keys = expected();
    expect(keys.length).toBeGreaterThan(40);
    for (const locale of ["uk", "en"] as const) {
      const messages = await messagesForArea(locale, MESSAGE_FILES);
      expect(
        keys.filter((key) => !(key in messages)),
        locale,
      ).toEqual([]);
    }
  });
});
