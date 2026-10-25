import { describe, expect, it } from "vitest";
import { createTranslator } from "@fluxkit/ui";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { SHIPMENT_STATUSES, UNAVAILABLE_REASONS } from "./shipping-model";
import {
  orderShippingPriceText,
  pickupKindKey,
  shipmentStatusKey,
  shippingPriceText,
  unavailableText,
} from "./shipping-text";
import { sentinelTranslator } from "../components/test-helpers";

const money = (value: { amount: number }) => `M${String(value.amount)}`;
const t = sentinelTranslator();
const UAH = (amount: number) => ({ amount, currency: "UAH" });

describe("shippingPriceText", () => {
  it("shows the price the shop charges, formatted by the caller", () => {
    expect(
      shippingPriceText(t, { price: UAH(5000), payer: "shop_charge", estimate: null }, money),
    ).toBe("M5000");
  });

  it("says Free for a zero price (the shop charges nothing)", () => {
    expect(
      shippingPriceText(t, { price: UAH(0), payer: "shop_charge", estimate: null }, money),
    ).toBe("§checkout.shipping.price.free");
  });

  it("says the carrier is paid on delivery, with the carrier's estimate when there is one", () => {
    const onDelivery = { price: UAH(0), payer: "recipient_on_delivery" as const };
    expect(shippingPriceText(t, { ...onDelivery, estimate: null }, money)).toBe(
      "§checkout.shipping.price.onDelivery",
    );
    expect(shippingPriceText(t, { ...onDelivery, estimate: UAH(8800) }, money)).toBe(
      "§checkout.shipping.price.onDeliveryEstimate",
    );
    const real = createTranslator(en, "en");
    expect(shippingPriceText(real, { ...onDelivery, estimate: UAH(8800) }, money)).toBe(
      "Paid to the carrier on delivery, about M8800",
    );
  });

  it("is empty for an option without a price", () => {
    expect(shippingPriceText(t, { price: null, payer: null, estimate: null }, money)).toBe("");
  });
});

describe("orderShippingPriceText", () => {
  it("uses the amount of the snapshot, Free for zero, and the carrier wording on delivery", () => {
    const base = { estimatedCarrierAmount: null };
    expect(
      orderShippingPriceText(t, { ...base, amount: UAH(5000), payer: "shop_charge" }, money),
    ).toBe("M5000");
    expect(
      orderShippingPriceText(t, { ...base, amount: UAH(0), payer: "shop_charge" }, money),
    ).toBe("§order.shipping.free");
    expect(
      orderShippingPriceText(
        t,
        { amount: UAH(0), payer: "recipient_on_delivery", estimatedCarrierAmount: UAH(7500) },
        money,
      ),
    ).toBe("§order.shipping.onDeliveryEstimate");
  });
});

describe("keys", () => {
  it("has a message in both locales for every unavailable reason, every shipment status and the fallbacks", () => {
    for (const messages of [en, uk] as Record<string, string>[]) {
      for (const reason of UNAVAILABLE_REASONS) {
        expect(messages[`checkout.shipping.unavailable.${reason}`]).toBeTruthy();
      }
      for (const status of SHIPMENT_STATUSES) {
        expect(messages[shipmentStatusKey(status)], status).toBeTruthy();
      }
      expect(messages["checkout.shipping.unavailable.default"]).toBeTruthy();
      expect(messages["order.shipment.status.fallback"]).toBeTruthy();
      expect(messages[pickupKindKey("branch")]).toBeTruthy();
      expect(messages[pickupKindKey("locker")]).toBeTruthy();
    }
  });

  it("gives an unknown status, reason or kind a neutral text instead of a broken key", () => {
    expect(shipmentStatusKey("teleported" as never)).toBe("order.shipment.status.fallback");
    expect(unavailableText(t, { reason: "brand_new" as never })).toBe(
      "§checkout.shipping.unavailable.default",
    );
    expect(unavailableText(t, {})).toBe("§checkout.shipping.unavailable.default");
    expect(unavailableText(t, { reason: "country_not_served" })).toBe(
      "§checkout.shipping.unavailable.country_not_served",
    );
    expect(pickupKindKey("drone" as never)).toBe("checkout.shipping.point.kind.branch");
  });
});
