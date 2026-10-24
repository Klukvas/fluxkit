import { describe, expect, it } from "vitest";
import * as core from "../index.js";
import { DOMAIN_EVENT_HANDLER_METADATA } from "../orders/events.js";
import type { Money } from "../pricing/money.js";
import {
  MAX_PROVIDER_CODES,
  PROVIDER_FAILURE_REASONS,
  SHIPPING_CAPABILITIES,
  SHIPPING_PROVIDER_METADATA,
  SHIPPING_PROVIDER_PACKAGE_KIND,
  providerFailure,
  providerOk,
  shippingProviderMetadata,
} from "./provider-port.js";
import type {
  ProviderAbortSignal,
  ProviderFailureReason,
  ShippingProviderPort,
} from "./provider-port.js";

describe("the shipping provider port (ADR 0029 decision 9)", () => {
  it("has the metadata key and package kind of ADR 0029, distinct from the other keys and tokens", () => {
    expect(SHIPPING_PROVIDER_METADATA).toBe("fluxkit:shipping-provider");
    expect(SHIPPING_PROVIDER_PACKAGE_KIND).toBe("shipping");
    expect(SHIPPING_PROVIDER_METADATA).not.toBe(DOMAIN_EVENT_HANDLER_METADATA);
    expect(SHIPPING_PROVIDER_METADATA).not.toBe(core.MEDIA_STORAGE_PORT);
    expect(SHIPPING_PROVIDER_METADATA).not.toBe(core.ORDER_PAYMENTS_PORT);
    expect(SHIPPING_PROVIDER_METADATA).not.toBe(core.ORDER_READ_PORT);
  });

  it("builds the metadata value from a valid provider code only", () => {
    expect(shippingProviderMetadata("nova_poshta")).toEqual({ code: "nova_poshta" });
    expect(Object.isFrozen(shippingProviderMetadata("fake"))).toBe(true);
    for (const code of ["nova-poshta", "NovaPoshta", "", "1np"]) {
      expect(() => shippingProviderMetadata(code), code).toThrow(RangeError);
    }
  });

  it("lists the four failure reasons and six capabilities", () => {
    expect(PROVIDER_FAILURE_REASONS).toEqual([
      "unavailable",
      "rejected",
      "invalid_credentials",
      "not_supported",
    ]);
    expect(SHIPPING_CAPABILITIES).toEqual([
      "pickupPoints",
      "estimate",
      "waybills",
      "cancelWaybill",
      "tracking",
      "labels",
    ]);
  });

  it("wraps a value as a frozen success", () => {
    const money: Money = { amount: 6500, currency: "UAH" };
    const result = providerOk(money);
    expect(result).toEqual({ ok: true, value: money });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("builds a frozen failure with copied carrier codes", () => {
    const codes = ["20000200039", "ERR.LIMIT_1"];
    const result = providerFailure("rejected", codes);
    expect(result).toEqual({ ok: false, reason: "rejected", providerCodes: codes });
    expect(result.ok || result.providerCodes !== codes).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(providerFailure("unavailable")).toEqual({
      ok: false,
      reason: "unavailable",
      providerCodes: [],
    });
  });

  it("refuses carrier message text as a code (it can echo a name, a phone or the key)", () => {
    for (const code of [
      "Sender phone +380501234567 is invalid",
      "Невірний ключ",
      "",
      "x".repeat(33),
      "a\nb",
    ]) {
      expect(() => providerFailure("rejected", [code]), code).toThrow(RangeError);
    }
    expect(() =>
      providerFailure(
        "rejected",
        Array.from({ length: MAX_PROVIDER_CODES + 1 }, () => "E1"),
      ),
    ).toThrow(RangeError);
    expect(() => providerFailure("timeout" as ProviderFailureReason)).toThrow(RangeError);
  });

  it("can be implemented by a plain object (a test double of a provider)", async () => {
    const notSupported = () => Promise.resolve(providerFailure("not_supported"));
    const port: ShippingProviderPort = {
      code: "fake",
      capabilities: {
        pickupPoints: true,
        estimate: false,
        waybills: false,
        cancelWaybill: false,
        tracking: false,
        labels: false,
      },
      searchCities: () => Promise.resolve([{ ref: "city-1", name: "Місто", region: null }]),
      listPickupPoints: () => Promise.resolve([]),
      findPickupPoint: ({ ref }) =>
        Promise.resolve(
          ref === "point-1"
            ? {
                ref,
                number: "1",
                kind: "branch" as const,
                cityRef: "city-1",
                cityName: "Місто",
                countryCode: "UA",
                description: "Відділення 1",
                maxWeightGrams: null,
              }
            : null,
        ),
      estimate: notSupported,
      createWaybill: notSupported,
      findWaybill: notSupported,
      cancelWaybill: notSupported,
      track: notSupported,
      fetchLabel: notSupported,
      checkConnection: () => Promise.resolve(providerOk(undefined)),
    };
    const signal: ProviderAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      throwIfAborted: () => undefined,
    };
    expect(await port.searchCities({ query: "Мі", locale: "uk", limit: 10 }, signal)).toHaveLength(
      1,
    );
    expect((await port.findPickupPoint({ ref: "point-1" }, signal))?.countryCode).toBe("UA");
    expect(await port.findPickupPoint({ ref: "point-2" }, signal)).toBeNull();
    expect(await port.track({ trackingNumbers: ["1"], phones: [] }, signal)).toEqual({
      ok: false,
      reason: "not_supported",
      providerCodes: [],
    });
    expect((await port.checkConnection(signal)).ok).toBe(true);
  });
});
