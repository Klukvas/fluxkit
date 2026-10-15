import { describe, expect, it } from "vitest";
import { validateAttributeValues } from "./attribute-values.js";
import { resolveText, validateI18nText } from "./i18n.js";
import { publishPreconditions } from "./lifecycle.js";
import { normalizeSku, validateSku } from "./sku.js";
import { slugify } from "./slug.js";
import type { AttributeDefinition, ProductSnapshot, ProductTypeDefinition } from "./types.js";
import { computeOptionSignature, generateVariants } from "./variants.js";

// Regression tests for the findings of the independent adversarial review of this module.

const locales = { defaultLocale: "uk", locales: ["uk", "en"] } as const;

function textAttribute(code: string, isRequired = false): ProductTypeDefinition["attributes"][number] {
  const definition: AttributeDefinition = {
    code,
    inputType: "text",
    isLocalized: false,
    unit: null,
    validation: {},
    isFilterable: false,
    isSearchable: false,
    isVisibleOnStorefront: true,
    isComparable: false,
    isSortable: false,
    isInternal: false,
    options: [],
  };
  return { attribute: definition, level: "product", isRequired };
}

describe("publishPreconditions cannot be switched to draft mode by its config argument", () => {
  const type: ProductTypeDefinition = {
    code: "t",
    allowedOptionCodes: [],
    attributes: [textAttribute("req", true)],
  };
  const product: ProductSnapshot = {
    status: "draft",
    slug: "p",
    title: { uk: "Назва" },
    publishedAt: null,
    attributes: {},
    optionCodes: [],
    variants: [
      {
        sku: "P-1",
        isDefault: true,
        isActive: true,
        optionSignature: "",
        optionValues: [],
        attributes: {},
      },
    ],
  };

  it("reports the missing required attribute even when config carries mode: draft", () => {
    const sneaky = { ...locales, mode: "draft" } as typeof locales;
    const violations = publishPreconditions(product, type, sneaky);
    expect(violations.some((violation) => violation.code === "attribute_invalid")).toBe(true);
  });
});

describe("strings that Postgres jsonb would reject are refused with a field error", () => {
  const type: ProductTypeDefinition = {
    code: "t",
    allowedOptionCodes: [],
    attributes: [textAttribute("txt")],
  };

  it("rejects NUL characters and lone surrogates in attribute text", () => {
    for (const bad of ["a\u0000b", "\ud800", "x\udc00y"]) {
      const result = validateAttributeValues(type, "product", { txt: bad }, { ...locales, mode: "draft" });
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("accepts ordinary text including emoji (valid surrogate pairs)", () => {
    const result = validateAttributeValues(type, "product", { txt: "ok 😀" }, { ...locales, mode: "draft" });
    expect(result.ok).toBe(true);
  });

  it("rejects the same characters in i18n texts", () => {
    const options = { ...locales, maxLength: 255, required: true };
    expect(validateI18nText({ uk: "a\u0000b" }, options).ok).toBe(false);
    expect(validateI18nText({ uk: "\ud800" }, options).ok).toBe(false);
    expect(validateI18nText({ uk: "Футболка 😀" }, options).ok).toBe(true);
  });
});

describe("slugify keeps word-start romanization after opening quotes", () => {
  it("treats a quote that follows a space as punctuation, not as an in-word apostrophe", () => {
    expect(slugify("Книга 'Ярослав'")).toBe("knyha-yaroslav");
    expect(slugify("‘Євро’")).toBe("yevro");
    expect(slugify("Книга «Їжак»")).toBe("knyha-yizhak");
  });

  it("still handles real in-word apostrophes", () => {
    expect(slugify("Знам'янка")).toBe("znamianka");
    expect(slugify("Мʼясо")).toBe("miaso");
  });
});

describe("option codes are validated so that signatures stay unambiguous", () => {
  it("computeOptionSignature refuses codes that do not match the code pattern", () => {
    expect(() => computeOptionSignature([{ optionCode: "a", valueCode: "x;b=y" }])).toThrow(/code/i);
    expect(() => computeOptionSignature([{ optionCode: "A b", valueCode: "x" }])).toThrow(/code/i);
  });

  it("generateVariants returns a typed error for invalid codes", () => {
    const result = generateVariants({
      options: [{ code: "a", valueCodes: ["x;b=y"] }],
      existingSignatures: new Set(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.reason === "invalid_code")).toBe(true);
    }
  });
});

describe("SKU normalization only uppercases ASCII letters", () => {
  it("rejects letters that Unicode case-mapping would turn into ASCII", () => {
    for (const raw of ["ſku1", "straße", "ıtem", "ﬁx"]) {
      const result = validateSku(raw);
      expect(result.ok, raw).toBe(false);
    }
  });

  it("still uppercases plain ASCII and trims", () => {
    expect(normalizeSku("  abc-1 ")).toBe("ABC-1");
    expect(validateSku(" abc-1 ")).toEqual({ ok: true, sku: "ABC-1" });
  });
});

describe("resolveText ignores inherited properties", () => {
  it("falls back to the default locale for prototype property names", () => {
    expect(resolveText({ uk: "Назва" }, "constructor", "uk")).toBe("Назва");
    expect(resolveText({ uk: "Назва" }, "__proto__", "uk")).toBe("Назва");
    expect(resolveText({ uk: "Назва" }, "toString", "uk")).toBe("Назва");
  });
});

describe("limit overrides set to undefined do not switch a limit off", () => {
  it("keeps the default maximum number of options", () => {
    const result = generateVariants({
      options: ["a", "b", "c", "d"].map((code) => ({ code, valueCodes: ["x"] })),
      existingSignatures: new Set(),
      limits: { maxOptionsPerProduct: undefined },
    });
    expect(result.ok).toBe(false);
  });
});
