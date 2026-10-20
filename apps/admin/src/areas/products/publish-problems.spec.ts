import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  mapPublishProblems,
  problemsOnTab,
  variantIssues,
  variantProblems,
  type PublishProblem,
} from "./publish-problems";

const context = {
  defaultLocale: "uk",
  variants: [
    { id: "va", sku: "SKU-A" },
    { id: "vb", sku: "SKU-B" },
    { id: "vc", sku: "SKU-C" },
  ],
};

function problem(errors: { path: string; code: string }[]): ProblemDetails {
  return {
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    code: "validation_failed",
    detail: "The product cannot be published yet.",
    errors,
  };
}

const one = (path: string, code: string): PublishProblem => {
  const [mapped] = mapPublishProblems(problem([{ path, code }]), context);
  if (mapped === undefined) throw new Error("nothing mapped");
  return mapped;
};

describe("publish problems on the editor's tabs", () => {
  it("puts title, description, slug and brand problems on General, focusing the field", () => {
    expect(one("title.uk", "empty")).toEqual({
      path: "title.uk",
      tab: "general",
      field: "title.uk",
      focusId: "product-title-uk",
      message: { key: "errors.reason.empty" },
    });
    expect(one("title", "required")).toMatchObject({
      tab: "general",
      field: "title.uk",
      focusId: "product-title-uk",
    });
    expect(one("title.en", "too_long")).toMatchObject({ focusId: "product-title-en" });
    expect(one("description.en", "too_long")).toMatchObject({
      tab: "general",
      field: "description.en",
      focusId: "product-description-en",
    });
    expect(one("slug", "slug_missing")).toEqual({
      path: "slug",
      tab: "general",
      field: "slug",
      focusId: "product-slug",
      message: { key: "errors.reason.slug_missing" },
    });
    expect(one("brandId", "invalid_reference")).toMatchObject({
      tab: "general",
      field: "brandId",
      focusId: "product-brand",
    });
  });

  it("puts product attribute problems on Attributes, on the attribute (and locale), with the attribute reason", () => {
    expect(one("attributes.model_code", "required")).toEqual({
      path: "attributes.model_code",
      tab: "attributes",
      field: "attributes.model_code",
      focusId: "product-attribute-model_code",
      attributeCode: "model_code",
      message: { key: "products.attributeReason.required" },
    });
    expect(one("attributes.note.uk", "default_locale_missing")).toMatchObject({
      tab: "attributes",
      field: "attributes.note.uk",
      focusId: "product-attribute-note-uk",
      attributeCode: "note",
    });
    expect(one("attributes", "values_too_large")).toMatchObject({
      tab: "attributes",
      field: null,
      focusId: null,
    });
  });

  it("puts variants.N problems on the variant's row in Variants: N is the index in the product detail's variant order", () => {
    expect(one("variants.1", "price_missing")).toEqual({
      path: "variants.1",
      tab: "variants",
      field: null,
      focusId: "product-variant-vb",
      variantIndex: 1,
      variantId: "vb",
      variantSku: "SKU-B",
      message: { key: "errors.reason.price_missing" },
    });
    expect(one("variants.0", "default_variant_inactive")).toMatchObject({
      variantIndex: 0,
      variantId: "va",
      variantSku: "SKU-A",
      focusId: "product-variant-va",
    });
  });

  it("puts a variant attribute problem on that variant's attribute field (and locale), with the attribute reason", () => {
    expect(one("variants.2.attributes.per_variant", "required")).toEqual({
      path: "variants.2.attributes.per_variant",
      tab: "variants",
      field: "attributes.per_variant",
      focusId: "product-variant-vc",
      variantIndex: 2,
      variantId: "vc",
      variantSku: "SKU-C",
      attributeCode: "per_variant",
      message: { key: "products.attributeReason.required" },
    });
    expect(one("variants.0.attributes.note.en", "too_long")).toMatchObject({
      field: "attributes.note.en",
      variantId: "va",
      attributeCode: "note",
    });
  });

  it("keeps a product-wide variant problem and a stale index on the tab's own list", () => {
    const wide = one("variants", "no_active_variant");
    expect(wide).toMatchObject({ tab: "variants", focusId: "product-variants" });
    expect(wide.variantIndex).toBeUndefined();
    expect(wide.variantId).toBeUndefined();
    const stale = one("variants.7", "price_missing");
    expect(stale).toMatchObject({ tab: "variants", variantIndex: 7, focusId: "product-variants" });
    expect(stale.variantSku).toBeUndefined();
    expect(stale.variantId).toBeUndefined();
  });

  it("puts option, category and media problems on their tabs, on the option or the image's field", () => {
    expect(one("options.shade", "option_not_allowed")).toEqual({
      path: "options.shade",
      tab: "options",
      field: "options.shade",
      focusId: "product-option-shade",
      message: { key: "errors.reason.option_not_allowed" },
    });
    expect(one("options", "too_many_options")).toMatchObject({
      tab: "options",
      field: null,
      focusId: "product-options",
    });
    expect(one("categories", "required")).toMatchObject({
      tab: "categories",
      focusId: "product-categories",
    });
    expect(one("categories.0.categoryId", "invalid_reference")).toMatchObject({
      tab: "categories",
    });
    expect(one("primaryCategoryId", "primary_not_assigned")).toMatchObject({
      tab: "categories",
    });
    expect(one("media.3.url", "invalid_format")).toEqual({
      path: "media.3.url",
      tab: "media",
      field: "media.3.url",
      focusId: "product-media-3-url",
      message: { key: "errors.reason.invalid_format" },
    });
    expect(one("media.0.alt.en", "too_long")).toMatchObject({
      field: "media.0.alt.en",
      focusId: "product-media-0-alt-en",
    });
    expect(one("media.1.optionValueId", "invalid_reference")).toMatchObject({
      field: "media.1.optionValueId",
      focusId: "product-media-1-link",
    });
    expect(one("media", "too_big")).toMatchObject({
      tab: "media",
      field: null,
      focusId: "product-media",
    });
  });

  it("keeps a problem of a path no tab owns, without a link, and an unknown code with its code", () => {
    expect(one("somewhere", "brand_new_code")).toEqual({
      path: "somewhere",
      tab: null,
      field: null,
      focusId: null,
      message: { key: "errors.generic", code: "brand_new_code" },
    });
  });

  it("maps every error of the answer, in order, and nothing for an answer without errors", () => {
    const mapped = mapPublishProblems(
      problem([
        { path: "title.uk", code: "empty" },
        { path: "attributes.model_code", code: "required" },
        { path: "variants.0", code: "price_missing" },
      ]),
      context,
    );
    expect(mapped.map((entry) => entry.tab)).toEqual(["general", "attributes", "variants"]);
    expect(
      mapPublishProblems({ ...problem([]), errors: undefined } as ProblemDetails, context),
    ).toEqual([]);
  });

  it("gives each tab its own problems as field issues", () => {
    const mapped = mapPublishProblems(
      problem([
        { path: "title.uk", code: "empty" },
        { path: "attributes.model_code", code: "required" },
        { path: "attributes.model_code", code: "too_short" },
        { path: "attributes", code: "values_too_large" },
        { path: "media.0.url", code: "invalid_format" },
      ]),
      context,
    );
    expect(problemsOnTab(mapped, "general")).toEqual({
      "title.uk": { key: "errors.reason.empty" },
    });
    expect(problemsOnTab(mapped, "attributes")).toEqual({
      "attributes.model_code": { key: "products.attributeReason.required" },
    });
    expect(problemsOnTab(mapped, "media")).toEqual({
      "media.0.url": { key: "errors.reason.invalid_format" },
    });
    expect(problemsOnTab(mapped, "categories")).toEqual({});
  });

  it("gives one variant its own problems, and its attribute problems as field issues of its form", () => {
    const mapped = mapPublishProblems(
      problem([
        { path: "variants.0.attributes.per_variant", code: "required" },
        { path: "variants.1.attributes.per_variant", code: "too_long" },
        { path: "variants.0", code: "price_missing" },
      ]),
      context,
    );
    expect(variantIssues(mapped, "va")).toEqual({
      "attributes.per_variant": { key: "products.attributeReason.required" },
    });
    expect(variantIssues(mapped, "vb")).toEqual({
      "attributes.per_variant": { key: "products.attributeReason.too_long" },
    });
    expect(variantProblems(mapped, "va").map((entry) => entry.path)).toEqual([
      "variants.0.attributes.per_variant",
      "variants.0",
    ]);
    expect(variantIssues(mapped, "vz")).toEqual({});
    // Variant fields are per variant: the tab-wide issues never mix two variants' errors.
    expect(problemsOnTab(mapped, "variants")).toEqual({});
  });
});
