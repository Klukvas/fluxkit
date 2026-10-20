import type { AdminProduct } from "@fluxkit/api-client";
import { TEXT_LIMITS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  emptyProductForm,
  productCreateBody,
  productFormFrom,
  productPatchBody,
  validateProductForm,
  type ProductFormValues,
} from "./product-form";

const content = { defaultLocale: "uk", locales: ["uk", "en"] };
const TYPE = "22222222-2222-4222-8222-222222222222";
const BRAND = "33333333-3333-4333-8333-333333333333";

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    productTypeId: TYPE,
    brandId: BRAND,
    slug: "first-product",
    title: { uk: "Перший", en: "First" },
    description: { uk: "Опис" },
    status: "draft",
    attributes: {},
    publishedAt: null,
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    categories: [],
    media: [],
    variants: [],
    options: [],
    ...overrides,
  };
}

const filled = (values: Partial<ProductFormValues> = {}): ProductFormValues => ({
  ...emptyProductForm(content.locales),
  productTypeId: TYPE,
  title: { uk: "Новий", en: "" },
  ...values,
});

describe("product general form: limits", () => {
  it("are core's", () => {
    expect(TITLE_MAX_LENGTH).toBe(TEXT_LIMITS.title);
    expect(DESCRIPTION_MAX_LENGTH).toBe(TEXT_LIMITS.description);
  });
});

describe("product general form: early checks", () => {
  it("needs a product type and the default-locale title on create; slug may be empty (the API generates it)", () => {
    expect(validateProductForm(emptyProductForm(content.locales), content, "create")).toEqual({
      productTypeId: { key: "dict.error.pickerRequired" },
      "title.uk": { key: "errors.reason.default_locale_missing" },
    });
    expect(validateProductForm(filled(), content, "create")).toEqual({});
  });

  it("checks the slug format and length when one is given, and needs a slug on edit", () => {
    expect(validateProductForm(filled({ slug: "Not A Slug" }), content, "create")).toEqual({
      slug: { key: "dict.error.slugFormat" },
    });
    expect(validateProductForm(filled({ slug: "a".repeat(161) }), content, "create")).toEqual({
      slug: { key: "dict.error.slugFormat" },
    });
    expect(validateProductForm(filled({ slug: "  " }), content, "edit")).toEqual({
      slug: { key: "errors.reason.required" },
    });
    expect(validateProductForm(filled({ slug: "ok-slug" }), content, "edit")).toEqual({});
  });

  it("refuses a title or description over the core limits, per locale", () => {
    const issues = validateProductForm(
      filled({
        title: { uk: "x".repeat(TITLE_MAX_LENGTH + 1), en: "fine" },
        description: { uk: "", en: "y".repeat(DESCRIPTION_MAX_LENGTH + 1) },
      }),
      content,
      "create",
    );
    expect(issues).toEqual({
      "title.uk": { key: "errors.reason.too_long" },
      "description.en": { key: "errors.reason.too_long" },
    });
  });
});

describe("product general form: create body", () => {
  it("sends the type, the title map without blank locales, and nothing for empty optional fields", () => {
    expect(
      productCreateBody(filled({ title: { uk: " Новий ", en: " " } }), content.locales),
    ).toEqual({ productTypeId: TYPE, title: { uk: "Новий" } });
  });

  it("sends slug, brand and description when given", () => {
    expect(
      productCreateBody(
        filled({ slug: " my-slug ", brandId: BRAND, description: { uk: "", en: "Text" } }),
        content.locales,
      ),
    ).toEqual({
      productTypeId: TYPE,
      title: { uk: "Новий" },
      slug: "my-slug",
      brandId: BRAND,
      description: { en: "Text" },
    });
  });
});

describe("product general form: PATCH body (changed fields only)", () => {
  const original = product();
  const initial = productFormFrom(original, content.locales);

  it("reads the stored product into the form", () => {
    expect(initial).toEqual({
      productTypeId: TYPE,
      slug: "first-product",
      brandId: BRAND,
      title: { uk: "Перший", en: "First" },
      description: { uk: "Опис", en: "" },
    });
    expect(
      productFormFrom(product({ brandId: null, description: null }), content.locales),
    ).toMatchObject({
      brandId: "",
      description: { uk: "", en: "" },
    });
  });

  it("sends nothing when nothing changed", () => {
    expect(productPatchBody(initial, initial, content.locales)).toEqual({});
    expect(
      productPatchBody(initial, { ...initial, slug: " first-product " }, content.locales),
    ).toEqual({});
  });

  it("sends only the changed field; a changed locale map is sent whole", () => {
    expect(
      productPatchBody(
        initial,
        { ...initial, title: { uk: "Перший", en: "First!" } },
        content.locales,
      ),
    ).toEqual({ title: { uk: "Перший", en: "First!" } });
    expect(productPatchBody(initial, { ...initial, slug: "renamed" }, content.locales)).toEqual({
      slug: "renamed",
    });
  });

  it("clears the brand and the description with null, and never sends the product type", () => {
    expect(
      productPatchBody(
        initial,
        { ...initial, brandId: "", description: { uk: " ", en: "" } },
        content.locales,
      ),
    ).toEqual({ brandId: null, description: null });
    const body = productPatchBody(
      initial,
      { ...initial, productTypeId: "99999999-9999-4999-8999-999999999999" },
      content.locales,
    );
    expect(body).toEqual({});
  });
});
