import type { AdminShippingMethod } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  emptyMethodForm,
  kindUsesProvider,
  methodCreateBody,
  methodFormFrom,
  methodPatchBody,
  parseCountries,
  pricedInShopCurrency,
  validateMethodForm,
  type MethodFormContext,
  type MethodFormValues,
} from "./method-form";

const context: MethodFormContext = { defaultLocale: "uk", locales: ["uk", "en"], exponent: 2 };

function stored(overrides: Partial<AdminShippingMethod> = {}): AdminShippingMethod {
  return {
    id: "0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f",
    code: "courier",
    title: { uk: "Кур'єр", en: "Courier" },
    description: null,
    kind: "address",
    providerCode: "fake",
    providerService: null,
    pricing: { type: "flat", amount: 8050 },
    currency: "UAH",
    countryCodes: ["UA", "PL"],
    isActive: true,
    position: 3,
    createdAt: "2026-10-24T10:00:00.000Z",
    updatedAt: "2026-10-24T10:00:00.000Z",
    ...overrides,
  };
}

function filled(overrides: Partial<MethodFormValues> = {}): MethodFormValues {
  return {
    ...emptyMethodForm(context.locales),
    code: "post",
    title: { uk: "Пошта", en: "" },
    countries: "UA",
    pricing: { type: "flat", amount: "80", freeFrom: "", tiers: [] },
    ...overrides,
  };
}

const keys = (found: ReturnType<typeof validateMethodForm>) =>
  Object.fromEntries(Object.entries(found).map(([path, d]) => [path, d?.key]));

describe("parseCountries", () => {
  it("upper-cases and splits on commas, semicolons and spaces, keeping the typed order", () => {
    expect(parseCountries("ua, pl;de  fr")).toEqual({ ok: true, codes: ["UA", "PL", "DE", "FR"] });
  });

  it("refuses an empty list, a malformed code, a repeated country and more than 250", () => {
    expect(parseCountries("  ")).toMatchObject({
      ok: false,
      issue: { key: "errors.reason.required" },
    });
    expect(parseCountries("UA, UKR")).toMatchObject({
      ok: false,
      issue: { key: "ship.error.countryFormat", values: { code: "UKR" } },
    });
    expect(parseCountries("U1")).toMatchObject({ ok: false });
    expect(parseCountries("UA PL ua")).toMatchObject({
      ok: false,
      issue: { key: "ship.reason.duplicate_country", values: { code: "UA" } },
    });
    const many = Array.from(
      { length: 251 },
      (_, i) =>
        `${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
    ).join(" ");
    expect(parseCountries(many)).toMatchObject({
      ok: false,
      issue: { key: "ship.error.countriesTooMany" },
    });
  });
});

describe("validateMethodForm", () => {
  it("accepts a complete address method", () => {
    expect(validateMethodForm(filled(), "create", context)).toEqual({});
  });

  it("checks the code on create only, and the title in the default language", () => {
    expect(keys(validateMethodForm(filled({ code: "Bad Code" }), "create", context))).toEqual({
      code: "ship.error.codeFormat",
    });
    expect(validateMethodForm(filled({ code: "Bad Code" }), "edit", context)).toEqual({});
    expect(
      keys(validateMethodForm(filled({ title: { uk: "  ", en: "Post" } }), "create", context)),
    ).toEqual({ "title.uk": "errors.reason.default_locale_missing" });
  });

  it("needs a carrier for a pickup point, and for a service; a store pickup takes none", () => {
    expect(
      keys(
        validateMethodForm(filled({ kind: "pickup_point", providerCode: "" }), "create", context),
      ),
    ).toEqual({ providerCode: "ship.reason.provider_required" });
    expect(
      keys(validateMethodForm(filled({ providerService: "express" }), "create", context)),
    ).toEqual({ providerCode: "ship.reason.provider_required" });
    expect(
      validateMethodForm(
        filled({ kind: "store_pickup", providerCode: "Not A Code", providerService: "x" }),
        "create",
        context,
      ),
    ).toEqual({});
    expect(kindUsesProvider("store_pickup")).toBe(false);
    expect(keys(validateMethodForm(filled({ providerCode: "Fake!" }), "create", context))).toEqual({
      providerCode: "ship.error.codeFormat",
    });
  });

  it("reports countries, position and pricing on the API's paths, all at once", () => {
    const found = validateMethodForm(
      filled({
        countries: "",
        position: "-1",
        pricing: { type: "flat", amount: "1.005", freeFrom: "", tiers: [] },
      }),
      "create",
      context,
    );
    expect(keys(found)).toEqual({
      countryCodes: "errors.reason.required",
      position: "ship.error.position",
      "pricing.amount": "ship.money.too_many_decimals",
    });
  });
});

describe("methodCreateBody", () => {
  it("holds the typed values: minor units, upper-case countries, trimmed texts, no empty optional member", () => {
    expect(methodCreateBody(filled(), context)).toEqual({
      code: "post",
      title: { uk: "Пошта" },
      kind: "address",
      pricing: { type: "flat", amount: 8000 },
      countryCodes: ["UA"],
      isActive: false,
    });
  });

  it("sends the carrier, service, description and position when typed", () => {
    expect(
      methodCreateBody(
        filled({
          providerCode: " fake ",
          providerService: " express ",
          description: { uk: "", en: "Two days" },
          position: "5",
          isActive: true,
        }),
        context,
      ),
    ).toMatchObject({
      providerCode: "fake",
      providerService: "express",
      description: { en: "Two days" },
      position: 5,
      isActive: true,
    });
  });

  it("sends no carrier for a store pickup, whatever was typed before switching the kind", () => {
    const body = methodCreateBody(
      filled({ kind: "store_pickup", providerCode: "fake", providerService: "express" }),
      context,
    );
    expect(body).not.toHaveProperty("providerCode");
    expect(body).not.toHaveProperty("providerService");
  });

  it("uses the shop currency's exponent: 80 is 80 in yen and 80000 in dinars", () => {
    const flat = filled({ pricing: { type: "flat", amount: "80", freeFrom: "", tiers: [] } });
    expect(methodCreateBody(flat, { ...context, exponent: 0 }).pricing).toEqual({
      type: "flat",
      amount: 80,
    });
    expect(methodCreateBody(flat, { ...context, exponent: 3 }).pricing).toEqual({
      type: "flat",
      amount: 80000,
    });
  });

  it("refuses invalid values instead of sending a guess", () => {
    expect(() => methodCreateBody(filled({ countries: "" }), context)).toThrow();
  });
});

describe("methodPatchBody (diffForPatch: changed fields only)", () => {
  const initial = methodFormFrom(stored(), context.locales, 2, "UAH");

  it("is empty when nothing changed", () => {
    expect(methodPatchBody(initial, { ...initial }, context, { pricingShown: true })).toEqual({});
  });

  it("round-trips the stored form: 80.50 is not a change", () => {
    expect(initial.pricing.amount).toBe("80.50");
    expect(initial.countries).toBe("UA, PL");
    expect(initial.position).toBe("3");
  });

  it("sends only what changed, a pricing and a country list whole", () => {
    const edited: MethodFormValues = {
      ...initial,
      isActive: false,
      pricing: { ...initial.pricing, amount: "99.99" },
      countries: "ua pl de",
    };
    expect(methodPatchBody(initial, edited, context, { pricingShown: true })).toEqual({
      isActive: false,
      pricing: { type: "flat", amount: 9999 },
      countryCodes: ["UA", "PL", "DE"],
    });
  });

  it("sends a locale map whole when one locale changes, and null when the description is cleared", () => {
    const withDescription = methodFormFrom(
      stored({ description: { uk: "Опис", en: "Text" } }),
      context.locales,
      2,
      "UAH",
    );
    expect(
      methodPatchBody(
        withDescription,
        { ...withDescription, title: { uk: "Кур'єр", en: "Courier Express" } },
        context,
        { pricingShown: true },
      ),
    ).toEqual({ title: { uk: "Кур'єр", en: "Courier Express" } });
    expect(
      methodPatchBody(
        withDescription,
        { ...withDescription, description: { uk: "", en: "" } },
        context,
        {
          pricingShown: true,
        },
      ),
    ).toEqual({ description: null });
  });

  it("clears the carrier with null when the kind becomes a store pickup", () => {
    expect(
      methodPatchBody(initial, { ...initial, kind: "store_pickup" }, context, {
        pricingShown: true,
      }),
    ).toEqual({ kind: "store_pickup", providerCode: null });
  });

  it("does not send an emptied position (the API cannot clear one)", () => {
    expect(
      methodPatchBody(initial, { ...initial, position: "" }, context, { pricingShown: true }),
    ).toEqual({});
  });
});

describe("a method priced in another currency", () => {
  const old = stored({ currency: "EUR", pricing: { type: "flat", amount: 1234 } });

  it("is detected, and its amounts are not shown in the shop currency's units", () => {
    expect(pricedInShopCurrency(old, "UAH")).toBe(false);
    expect(pricedInShopCurrency(old, "EUR")).toBe(true);
    const form = methodFormFrom(old, context.locales, 2, "UAH");
    expect(form.pricing.type).toBe("flat");
    expect(form.pricing.amount).toBe("");
  });

  it("always sends the typed pricing, so it is re-stamped with the shop currency", () => {
    const form = methodFormFrom(old, context.locales, 2, "UAH");
    const typed: MethodFormValues = { ...form, pricing: { ...form.pricing, amount: "12.34" } };
    expect(methodPatchBody(form, typed, context, { pricingShown: false })).toEqual({
      pricing: { type: "flat", amount: 1234 },
    });
  });
});
