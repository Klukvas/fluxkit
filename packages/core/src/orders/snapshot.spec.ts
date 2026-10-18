import { describe, expect, it } from "vitest";
import { MAX_LINE_QUANTITY } from "../cart/limits.js";
import { CATALOG_LIMITS, TEXT_LIMITS } from "../catalog/limits.js";
import { deepFreeze } from "../catalog/test-support.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import { buildOrderLine } from "./snapshot.js";
import type { OrderLineFacts, SnapshotOptions } from "./snapshot.js";

const options: SnapshotOptions = { defaultLocale: "uk", locales: ["uk", "en"] };

function facts(overrides: Partial<OrderLineFacts> = {}): OrderLineFacts {
  return {
    productId: "00000000-0000-4000-8000-000000000001",
    variantId: "00000000-0000-4000-8000-000000000002",
    sku: "TSHIRT-RED-M",
    productTitle: { uk: "Футболка", en: "T-shirt" },
    variantTitle: { uk: "Червона, M", en: "Red, M" },
    optionValues: [
      { option: { uk: "Колір", en: "Color" }, value: { uk: "Червоний", en: "Red" } },
      { option: { uk: "Розмір", en: "Size" }, value: { uk: "M", en: "M" } },
    ],
    imageUrl: "https://cdn.example.test/red.png",
    unitPrice: { amount: 129_900, currency: "UAH", compareAtAmount: 149_900 },
    quantity: 3,
    requiresShipping: true,
    ...overrides,
  };
}

function build(overrides: Partial<OrderLineFacts> = {}) {
  return buildOrderLine(deepFreeze(facts(overrides)), options);
}

function failure(overrides: Partial<OrderLineFacts>) {
  const result = build(overrides);
  if (result.ok) {
    throw new Error("expected a refusal");
  }
  return result;
}

describe("buildOrderLine", () => {
  it("freezes everything the order line needs, with full locale maps and the computed line total", () => {
    const result = build();
    expect(result).toEqual({
      ok: true,
      line: {
        productId: "00000000-0000-4000-8000-000000000001",
        variantId: "00000000-0000-4000-8000-000000000002",
        sku: "TSHIRT-RED-M",
        productTitle: { uk: "Футболка", en: "T-shirt" },
        variantTitle: { uk: "Червона, M", en: "Red, M" },
        optionValues: [
          { option: { uk: "Колір", en: "Color" }, value: { uk: "Червоний", en: "Red" } },
          { option: { uk: "Розмір", en: "Size" }, value: { uk: "M", en: "M" } },
        ],
        imageUrl: "https://cdn.example.test/red.png",
        unitPrice: { amount: 129_900, currency: "UAH" },
        compareAtAmount: 149_900,
        quantity: 3,
        lineTotal: { amount: 389_700, currency: "UAH" },
        requiresShipping: true,
      },
    });
  });

  it("deep-freezes the line and copies the texts, so the caller's objects can not change the snapshot", () => {
    const input = facts();
    const result = buildOrderLine(input, options);
    if (!result.ok) throw new Error("expected ok");
    const { line } = result;
    for (const frozen of [
      line,
      line.productTitle,
      line.variantTitle,
      line.optionValues,
      line.optionValues[0],
      line.optionValues[0]?.option,
      line.optionValues[0]?.value,
      line.unitPrice,
      line.lineTotal,
    ]) {
      expect(Object.isFrozen(frozen)).toBe(true);
    }
    (input.productTitle as Record<string, string>)["uk"] = "changed";
    (input.optionValues[0]?.value as Record<string, string>)["uk"] = "changed";
    expect(line.productTitle["uk"]).toBe("Футболка");
    expect(line.optionValues[0]?.value["uk"]).toBe("Червоний");
  });

  it("stores only the known fields and no extra input", () => {
    const result = buildOrderLine(
      { ...facts(), costPrice: 5, internalNote: "x" } as OrderLineFacts,
      options,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(Object.keys(result.line).sort()).toEqual(
      [
        "productId",
        "variantId",
        "sku",
        "productTitle",
        "variantTitle",
        "optionValues",
        "imageUrl",
        "unitPrice",
        "compareAtAmount",
        "quantity",
        "lineTotal",
        "requiresShipping",
      ].sort(),
    );
  });

  it("accepts a simple product: no variant title, no options, no image, no compare-at price, free of charge", () => {
    const result = build({
      variantTitle: null,
      optionValues: [],
      imageUrl: null,
      unitPrice: { amount: 0, currency: "UAH", compareAtAmount: null },
      requiresShipping: false,
    });
    expect(result).toMatchObject({
      ok: true,
      line: {
        variantTitle: null,
        optionValues: [],
        imageUrl: null,
        compareAtAmount: null,
        lineTotal: { amount: 0, currency: "UAH" },
        requiresShipping: false,
      },
    });
    if (result.ok) {
      expect(Object.is(result.line.lineTotal.amount, 0)).toBe(true);
    }
  });

  it("keeps a locale only the default has, and also a title that lacks the default locale", () => {
    expect(build({ productTitle: { uk: "Тільки укр" } }).ok).toBe(true);
    const english = build({ productTitle: { en: "English only" } });
    expect(english.ok && english.line.productTitle).toEqual({ en: "English only" });
  });

  describe("texts in locales that are no longer configured (review fix Medium 3)", () => {
    // The snapshot is history: it keeps every real translation, and any reader resolves it with the store's fallback
    // chain. LOCALES is uk,en here; a catalog written when de was configured must still be orderable.
    it("keeps a title that exists in uk, en and de only, de included", () => {
      const result = build({ productTitle: { uk: "Футболка", en: "T-shirt", de: "T-Shirt" } });
      expect(result.ok && result.line.productTitle).toEqual({
        uk: "Футболка",
        en: "T-shirt",
        de: "T-Shirt",
      });
    });

    it("accepts a title that exists only in a locale that is no longer configured", () => {
      const result = build({ productTitle: { de: "Nur Deutsch" } });
      expect(result.ok && result.line.productTitle).toEqual({ de: "Nur Deutsch" });
    });

    it("drops an empty or whitespace-only entry and keeps the real ones", () => {
      const result = build({ productTitle: { uk: "  ", en: "", de: "Titel" } });
      expect(result.ok && result.line.productTitle).toEqual({ de: "Titel" });
    });

    it("applies the same rule to the variant title and the option names and values", () => {
      const result = build({
        variantTitle: { de: "Rot, M" },
        optionValues: [{ option: { de: "Farbe" }, value: { en: "Red", de: "Rot" } }],
      });
      expect(result.ok && result.line.variantTitle).toEqual({ de: "Rot, M" });
      expect(result.ok && result.line.optionValues[0]).toEqual({
        option: { de: "Farbe" },
        value: { en: "Red", de: "Rot" },
      });
    });

    it("refuses only a truly empty text: no entry, or nothing but whitespace", () => {
      expect(failure({ productTitle: {} }).reason).toBe("invalid_product_title");
      expect(failure({ productTitle: { uk: " ", de: "" } }).reason).toBe("invalid_product_title");
    });
  });

  it("refuses ids that are not non-empty text", () => {
    for (const overrides of [
      { productId: "" },
      { variantId: "" },
      { productId: 5 as unknown as string },
      { variantId: undefined as unknown as string },
    ]) {
      expect(failure(overrides).reason).toBe("invalid_ids");
    }
  });

  it("refuses a SKU that is not a stored SKU (it is never normalized here)", () => {
    for (const sku of [
      "",
      "tshirt",
      " TSHIRT",
      "A".repeat(TEXT_LIMITS.sku + 1),
      "-A",
      5 as unknown as string,
    ]) {
      expect(failure({ sku }).reason, String(sku)).toBe("invalid_sku");
    }
    expect(build({ sku: "A".repeat(TEXT_LIMITS.sku) }).ok).toBe(true);
  });

  it("refuses bad titles", () => {
    expect(failure({ productTitle: {} }).reason).toBe("invalid_product_title");
    expect(failure({ productTitle: { uk: "  " } }).reason).toBe("invalid_product_title");
    expect(failure({ productTitle: { uk: "a".repeat(TEXT_LIMITS.title + 1) } }).reason).toBe(
      "invalid_product_title",
    );
    expect(failure({ productTitle: { uk: "a\u0000b" } }).reason).toBe("invalid_product_title");
    expect(failure({ productTitle: null as unknown as Record<string, string> }).reason).toBe(
      "invalid_product_title",
    );
    expect(failure({ variantTitle: {} }).reason).toBe("invalid_variant_title");
    expect(failure({ variantTitle: { de: "a\u0000b" } }).reason).toBe("invalid_variant_title");
    expect(build({ productTitle: { uk: "a".repeat(TEXT_LIMITS.title) } }).ok).toBe(true);
  });

  it("refuses bad option values", () => {
    expect(failure({ optionValues: undefined as unknown as [] }).reason).toBe(
      "invalid_option_values",
    );
    expect(failure({ optionValues: [{ option: { uk: "Колір" }, value: {} }] }).reason).toBe(
      "invalid_option_values",
    );
    expect(
      failure({ optionValues: [{ option: { en: "Color" }, value: { uk: " " } }] }).reason,
    ).toBe("invalid_option_values");
    const tooMany = Array.from({ length: CATALOG_LIMITS.maxOptionsPerProduct + 1 }, () => ({
      option: { uk: "o" },
      value: { uk: "v" },
    }));
    expect(failure({ optionValues: tooMany }).reason).toBe("invalid_option_values");
    expect(build({ optionValues: tooMany.slice(0, CATALOG_LIMITS.maxOptionsPerProduct) }).ok).toBe(
      true,
    );
  });

  it("accepts http and https image URLs only, without whitespace or control characters", () => {
    for (const imageUrl of [
      "",
      "ftp://x.test/a.png",
      "javascript:alert(1)",
      "//cdn.test/a.png",
      "/a.png",
      "https://cdn.test/a b.png",
      "https://cdn.test/a\n.png",
      "https://cdn.test/a\u0000.png",
      "https://",
      `https://x.test/${"a".repeat(TEXT_LIMITS.url)}`,
      5 as unknown as string,
    ]) {
      expect(failure({ imageUrl }).reason, String(imageUrl)).toBe("invalid_image_url");
    }
    expect(build({ imageUrl: "http://cdn.test/a.png" }).ok).toBe(true);
    expect(
      build({
        imageUrl: `https://x.test/${"a".repeat(TEXT_LIMITS.url - "https://x.test/".length)}`,
      }).ok,
    ).toBe(true);
  });

  it("refuses an invalid price and passes the price reason on", () => {
    expect(failure({ unitPrice: { amount: -1, currency: "UAH", compareAtAmount: null } })).toEqual({
      ok: false,
      reason: "invalid_price",
      priceReason: "negative_amount",
    });
    expect(failure({ unitPrice: { amount: 1.5, currency: "UAH", compareAtAmount: null } })).toEqual(
      {
        ok: false,
        reason: "invalid_price",
        priceReason: "not_an_integer",
      },
    );
    expect(
      failure({ unitPrice: { amount: 5, currency: "XXX", compareAtAmount: null } as never }),
    ).toEqual({
      ok: false,
      reason: "invalid_price",
      priceReason: "unsupported_currency",
    });
    expect(failure({ unitPrice: { amount: 5, currency: "UAH", compareAtAmount: 5 } })).toEqual({
      ok: false,
      reason: "invalid_price",
      priceReason: "compare_at_not_greater",
    });
    expect(failure({ unitPrice: null as never })).toEqual({
      ok: false,
      reason: "invalid_price",
      priceReason: "not_an_object",
    });
  });

  it("accepts quantities 1 to 999 and refuses everything else", () => {
    expect(build({ quantity: 1 }).ok).toBe(true);
    expect(build({ quantity: MAX_LINE_QUANTITY }).ok).toBe(true);
    for (const quantity of [
      0,
      -1,
      1.5,
      MAX_LINE_QUANTITY + 1,
      Number.NaN,
      "3" as unknown as number,
    ]) {
      expect(failure({ quantity }).reason, String(quantity)).toBe("invalid_quantity");
    }
  });

  it("refuses a line total that does not fit instead of clamping it", () => {
    expect(
      failure({
        unitPrice: { amount: MAX_AMOUNT, currency: "UAH", compareAtAmount: null },
        quantity: 999,
      }),
    ).toEqual({ ok: false, reason: "line_total_out_of_range" });
    expect(
      build({
        unitPrice: { amount: MAX_AMOUNT, currency: "UAH", compareAtAmount: null },
        quantity: 1,
      }).ok,
    ).toBe(true);
    const edge = build({
      unitPrice: { amount: 1_001_001_001, currency: "UAH", compareAtAmount: null },
      quantity: 999,
    });
    expect(edge).toMatchObject({ ok: true, line: { lineTotal: { amount: 999_999_999_999 } } });
    expect(
      failure({
        unitPrice: { amount: 1_001_001_002, currency: "UAH", compareAtAmount: null },
        quantity: 999,
      }).reason,
    ).toBe("line_total_out_of_range");
  });

  it("refuses a requiresShipping flag that is not a boolean", () => {
    for (const requiresShipping of [undefined, null, 1, "true"]) {
      expect(failure({ requiresShipping: requiresShipping as unknown as boolean }).reason).toBe(
        "invalid_requires_shipping",
      );
    }
  });

  it("reports the first failing field in a fixed order: ids, sku, titles, options, image, price, quantity", () => {
    expect(failure({ productId: "", sku: "x", quantity: 0 }).reason).toBe("invalid_ids");
    expect(failure({ sku: "x", quantity: 0 }).reason).toBe("invalid_sku");
    expect(failure({ productTitle: {}, quantity: 0 }).reason).toBe("invalid_product_title");
    expect(failure({ imageUrl: "", quantity: 0 }).reason).toBe("invalid_image_url");
    expect(
      failure({ unitPrice: { amount: -1, currency: "UAH", compareAtAmount: null }, quantity: 0 })
        .reason,
    ).toBe("invalid_price");
    expect(failure({ quantity: 0, requiresShipping: 1 as unknown as boolean }).reason).toBe(
      "invalid_quantity",
    );
  });

  it("treats an unusable configuration as a bug (RangeError)", () => {
    expect(() => buildOrderLine(facts(), { defaultLocale: "uk", locales: [] })).toThrow(RangeError);
    expect(() => buildOrderLine(facts(), { defaultLocale: "de", locales: ["uk", "en"] })).toThrow(
      RangeError,
    );
  });
});
