import { describe, expect, it } from "vitest";
import {
  SHIPMENT_LIMITS,
  isShipmentDirty,
  parseWholeNumber,
  planShipment,
  shipmentFormDefaults,
  type ShipmentFormValues,
} from "./shipment-form";

const order = { currency: "UAH", subtotal: { amount: 189_00, currency: "UAH" }, shipping: null };

function typed(overrides: Partial<ShipmentFormValues> = {}): ShipmentFormValues {
  return {
    ...shipmentFormDefaults(order, 2),
    weightGrams: "1500",
    lengthMm: "300",
    widthMm: "200",
    heightMm: "100",
    description: "Screwdriver set",
    ...overrides,
  };
}

const issueKeys = (plan: ReturnType<typeof planShipment>) =>
  plan.ok
    ? null
    : Object.fromEntries(Object.entries(plan.issues).map(([field, d]) => [field, d?.key]));

describe("shipmentFormDefaults", () => {
  it("declares the order subtotal, in the currency's own decimals", () => {
    expect(shipmentFormDefaults(order, 2).declaredValue).toBe("189.00");
    expect(
      shipmentFormDefaults({ ...order, subtotal: { amount: 18_900, currency: "JPY" } }, 0)
        .declaredValue,
    ).toBe("18900");
    expect(
      shipmentFormDefaults({ ...order, subtotal: { amount: 1_234, currency: "KWD" } }, 3)
        .declaredValue,
    ).toBe("1.234");
  });

  it("makes the recipient the payer when the recipient pays the carrier on delivery, else the sender", () => {
    const method = (payer: "shop_charge" | "recipient_on_delivery") => ({
      ...order,
      shipping: { payer } as never,
    });
    expect(shipmentFormDefaults(method("recipient_on_delivery"), 2).payer).toBe("recipient");
    expect(shipmentFormDefaults(method("shop_charge"), 2).payer).toBe("sender");
    expect(shipmentFormDefaults(order, 2).payer).toBe("sender");
  });

  it("leaves the parcel and the description empty: the shop sells anything, so there is no default size", () => {
    const defaults = shipmentFormDefaults(order, 2);
    expect([defaults.weightGrams, defaults.lengthMm, defaults.widthMm, defaults.heightMm]).toEqual([
      "",
      "",
      "",
      "",
    ]);
    expect(defaults.description).toBe("");
  });
});

describe("planShipment", () => {
  it("builds the body from typed values: whole numbers, trimmed description, declared value in minor units", () => {
    const plan = planShipment(typed({ description: "  Screwdriver set  " }), order, 2);
    expect(plan).toEqual({
      ok: true,
      body: {
        weightGrams: 1500,
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
        description: "Screwdriver set",
        declaredValue: { amount: 18_900, currency: "UAH" },
        payer: "sender",
      },
    });
  });

  it("converts the declared value with the order currency's exponent (no float): 0.29, JPY and KWD", () => {
    const body = (declaredValue: string, exponent: number) => {
      const plan = planShipment(typed({ declaredValue }), order, exponent);
      if (!plan.ok) throw new Error("expected a body");
      return plan.body.declaredValue;
    };
    expect(body("0.29", 2)).toEqual({ amount: 29, currency: "UAH" });
    expect(body("1.15", 2)).toEqual({ amount: 115, currency: "UAH" });
    expect(body("18900", 0)).toEqual({ amount: 18_900, currency: "UAH" });
    expect(body("1.234", 3)).toEqual({ amount: 1_234, currency: "UAH" });
    expect(issueKeys(planShipment(typed({ declaredValue: "1.005" }), order, 2))).toEqual({
      declaredValue: "shipment.money.too_many_decimals",
    });
    expect(issueKeys(planShipment(typed({ declaredValue: "1.5" }), order, 0))).toEqual({
      declaredValue: "shipment.money.too_many_decimals",
    });
  });

  it("uses the typed payer", () => {
    const plan = planShipment(typed({ payer: "recipient" }), order, 2);
    expect(plan.ok && plan.body.payer).toBe("recipient");
  });

  it("refuses the API's out-of-range parcel values and names each field", () => {
    expect(
      issueKeys(
        planShipment(
          typed({ weightGrams: "0", lengthMm: "10001", widthMm: "1.5", heightMm: "" }),
          order,
          2,
        ),
      ),
    ).toEqual({
      weightGrams: "shipment.error.tooSmall",
      lengthMm: "shipment.error.tooBig",
      widthMm: "shipment.error.wholeNumber",
      heightMm: "shipment.error.required",
    });
    expect(planShipment(typed({ weightGrams: "1000000", lengthMm: "10000" }), order, 2).ok).toBe(
      true,
    );
    expect(planShipment(typed({ weightGrams: "1000001" }), order, 2).ok).toBe(false);
  });

  it("checks the description like the API: required, at most 200, no control characters", () => {
    expect(issueKeys(planShipment(typed({ description: "   " }), order, 2))).toEqual({
      description: "order.field.required",
    });
    expect(issueKeys(planShipment(typed({ description: "x".repeat(201) }), order, 2))).toEqual({
      description: "order.field.too_long",
    });
    expect(planShipment(typed({ description: "x".repeat(200) }), order, 2).ok).toBe(true);
    expect(issueKeys(planShipment(typed({ description: "a\u0000b" }), order, 2))).toEqual({
      description: "order.field.invalid_characters",
    });
  });

  it("reports every problem at once, and builds no body", () => {
    const plan = planShipment(
      typed({ weightGrams: "", description: "", declaredValue: "" }),
      order,
      2,
    );
    expect(plan.ok).toBe(false);
    expect(Object.keys(issueKeys(plan) ?? {}).sort()).toEqual([
      "declaredValue",
      "description",
      "weightGrams",
    ]);
  });
});

describe("parseWholeNumber", () => {
  it("accepts ASCII digits only, trimmed, within the bounds", () => {
    expect(parseWholeNumber(" 42 ", 1, 100)).toEqual({ ok: true, value: 42 });
    for (const text of ["4.2", "-4", "+4", "1e2", "٣", "0x10", "4 2", "1000000000"]) {
      expect(parseWholeNumber(text, 1, 2_000_000_000), text).toMatchObject({ ok: false });
    }
    expect(SHIPMENT_LIMITS.weightGrams.max).toBe(1_000_000);
  });
});

describe("isShipmentDirty", () => {
  it("is false for the defaults and true after any change", () => {
    const defaults = shipmentFormDefaults(order, 2);
    expect(isShipmentDirty(defaults, defaults)).toBe(false);
    expect(isShipmentDirty({ ...defaults, description: "x" }, defaults)).toBe(true);
    expect(isShipmentDirty({ ...defaults, payer: "recipient" }, defaults)).toBe(true);
  });
});
