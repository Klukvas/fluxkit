import { describe, expect, it } from "vitest";
import { MAX_AMOUNT } from "../pricing/limits.js";
import type { Money } from "../pricing/money.js";
import { decideCheckoutConsent } from "./consent.js";

const uah = (amount: number): Money => ({ amount, currency: "UAH" });

describe("decideCheckoutConsent (ADR 0029 decision 4, consent)", () => {
  describe("without a shipping method (today's checkout, byte for byte)", () => {
    it("agrees when the expected total equals the total", () => {
      expect(
        decideCheckoutConsent({
          expectedTotal: uah(5_000),
          total: uah(5_000),
          shippingSelected: false,
          linePricesChanged: false,
        }),
      ).toEqual({ ok: true });
    });

    it("answers cart_changed for any other total, a minor unit off included", () => {
      for (const expected of [4_999, 5_001, 0, MAX_AMOUNT]) {
        expect(
          decideCheckoutConsent({
            expectedTotal: uah(expected),
            total: uah(5_000),
            shippingSelected: false,
            linePricesChanged: false,
          }),
          String(expected),
        ).toEqual({ ok: false, answer: "cart_changed" });
      }
    });

    it("answers cart_changed for an expected total in another currency", () => {
      expect(
        decideCheckoutConsent({
          expectedTotal: { amount: 5_000, currency: "USD" },
          total: uah(5_000),
          shippingSelected: false,
          linePricesChanged: true,
        }),
      ).toEqual({ ok: false, answer: "cart_changed" });
    });

    it("a missing total without a method is a bug of the caller", () => {
      expect(() =>
        decideCheckoutConsent({
          expectedTotal: uah(1),
          total: null,
          shippingSelected: false,
          linePricesChanged: false,
        }),
      ).toThrow(RangeError);
    });
  });

  describe("with a shipping method", () => {
    it("agrees when the expected total equals subtotal plus shipping, even after a line price changed", () => {
      expect(
        decideCheckoutConsent({
          expectedTotal: uah(5_500),
          total: uah(5_500),
          shippingSelected: true,
          linePricesChanged: true,
        }),
      ).toEqual({ ok: true });
    });

    it("answers cart_changed first when a line price changed since the shopper saw it", () => {
      expect(
        decideCheckoutConsent({
          expectedTotal: uah(5_500),
          total: uah(6_000),
          shippingSelected: true,
          linePricesChanged: true,
        }),
      ).toEqual({ ok: false, answer: "cart_changed" });
      // The method is gone too: the cart's own change still comes first.
      expect(
        decideCheckoutConsent({
          expectedTotal: uah(5_500),
          total: null,
          shippingSelected: true,
          linePricesChanged: true,
        }),
      ).toEqual({ ok: false, answer: "cart_changed" });
    });

    it("answers shipping_changed when only the shipping price differs", () => {
      expect(
        decideCheckoutConsent({
          expectedTotal: uah(5_500),
          total: uah(5_000),
          shippingSelected: true,
          linePricesChanged: false,
        }),
      ).toEqual({ ok: false, answer: "shipping_changed" });
    });

    it("answers shipping_changed when the method is no longer available (no total)", () => {
      expect(
        decideCheckoutConsent({
          expectedTotal: uah(5_500),
          total: null,
          shippingSelected: true,
          linePricesChanged: false,
        }),
      ).toEqual({ ok: false, answer: "shipping_changed" });
    });

    it("answers shipping_changed to a client that still sends the subtotal as the total", () => {
      expect(
        decideCheckoutConsent({
          expectedTotal: uah(5_000),
          total: uah(5_500),
          shippingSelected: true,
          linePricesChanged: false,
        }),
      ).toEqual({ ok: false, answer: "shipping_changed" });
    });
  });

  it("refuses input that is not money (a bug of the caller)", () => {
    expect(() =>
      decideCheckoutConsent({
        expectedTotal: { amount: 1.5, currency: "UAH" },
        total: uah(1),
        shippingSelected: false,
        linePricesChanged: false,
      }),
    ).toThrow(RangeError);
    expect(() =>
      decideCheckoutConsent({
        expectedTotal: uah(1),
        total: { amount: -1, currency: "UAH" },
        shippingSelected: true,
        linePricesChanged: false,
      }),
    ).toThrow(RangeError);
  });

  it("returns frozen answers", () => {
    const answer = decideCheckoutConsent({
      expectedTotal: uah(1),
      total: uah(2),
      shippingSelected: true,
      linePricesChanged: false,
    });
    expect(Object.isFrozen(answer)).toBe(true);
  });
});
