import { describe, expect, it } from "vitest";
import { messagesForArea } from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { CARRIER_REASONS } from "./shipment-carrier";
import { SHIPMENT_REFUSAL_RULES } from "./shipment-outcome";
import { SHIPMENT_STATUS_LIST } from "./shipment-view";

/** Message keys the shipment panel builds from data (the messages spec only sees literal keys). */
const BUILT_KEYS = [
  ...SHIPMENT_STATUS_LIST.map((status) => `shipment.status.${status}`),
  ...SHIPMENT_REFUSAL_RULES.map((rule) => `shipment.refusal.${rule}`),
  ...CARRIER_REASONS.map((reason) => `shipment.notice.failed.${reason}`),
  ...["refresh", "reconcile", "cancel", "label"].map((action) => `shipment.notice.lost.${action}`),
  ...["address", "pickup_point", "store_pickup"].map((kind) => `shipment.kind.${kind}`),
  ...["branch", "locker"].map((kind) => `shipment.pickupKind.${kind}`),
  ...["shop_charge", "recipient_on_delivery"].map((payer) => `shipment.snapshot.payer.${payer}`),
  ...["sender", "recipient"].map((payer) => `shipment.field.payer.${payer}`),
  ...[
    "empty",
    "comma_separator",
    "inner_space",
    "invalid_format",
    "too_many_decimals",
    "negative_zero",
    "negative_amount",
    "amount_out_of_range",
  ].map((reason) => `shipment.money.${reason}`),
  ...["awaiting_payment", "paid", "fulfilled", "cancelled", "expired"].map(
    (s) => `order.status.${s}`,
  ),
];

describe("shipment messages built from data", () => {
  it("exist in uk and en within the files the orders area loads", async () => {
    for (const locale of ["uk", "en"] as const) {
      const messages = await messagesForArea(locale, MESSAGE_FILES);
      for (const key of BUILT_KEYS) expect(key in messages, `${locale}: ${key}`).toBe(true);
    }
  });
});
