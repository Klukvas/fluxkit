import type { AdminBrand, AdminCategory, AdminOption, AdminProductType } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  attributeAssignmentBody,
  brandCreateBody,
  brandFormFrom,
  brandPatchBody,
  categoryCreateBody,
  categoryFormFrom,
  categoryPatchBody,
  emptyBrandForm,
  emptyCategoryForm,
  emptyItemForm,
  emptyOptionForm,
  emptyProductTypeForm,
  itemCreateBody,
  itemFormFrom,
  itemPatchBody,
  moveCategoryBody,
  optionAssignmentBody,
  optionCreateBody,
  optionFormFrom,
  optionPatchBody,
  productTypeCreateBody,
  productTypeFormFrom,
  productTypePatchBody,
  validateAttributeAssignment,
  validateBrandForm,
  validateCategoryForm,
  validateItemForm,
  validateMoveForm,
  validateOptionAssignment,
  validateOptionForm,
  validateProductTypeForm,
} from "./dictionary-forms";

const locales = ["uk", "en"];
const options = { defaultLocale: "uk", locales };
const stamp = { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };

describe("option form", () => {
  const option: AdminOption = {
    id: "o1",
    code: "color",
    name: { uk: "Колір", en: "Color" },
    ...stamp,
  };

  it("requires a valid code on create and the default locale of the name", () => {
    expect(
      validateOptionForm(
        { ...emptyOptionForm(locales), code: "color", name: { uk: "К", en: "" } },
        "create",
        options,
      ),
    ).toEqual({});
    const issues = validateOptionForm(emptyOptionForm(locales), "create", options);
    expect(issues["code"]?.key).toBe("dict.error.codeFormat");
    expect(issues["name.uk"]?.key).toBe("errors.reason.default_locale_missing");
    expect(
      validateOptionForm(
        { ...emptyOptionForm(locales), code: "", name: { uk: "К", en: "" } },
        "edit",
        options,
      ),
    ).toEqual({});
  });

  it("builds the create body and a patch of the name only when it changed", () => {
    expect(optionCreateBody({ code: "size", name: { uk: " Розмір ", en: "" } }, locales)).toEqual({
      code: "size",
      name: { uk: "Розмір" },
    });
    const initial = optionFormFrom(option, locales);
    expect(optionPatchBody(initial, structuredClone(initial), locales)).toEqual({});
    expect(
      optionPatchBody(initial, { ...initial, name: { uk: "Колір", en: "Colour" } }, locales),
    ).toEqual({
      name: { uk: "Колір", en: "Colour" },
    });
  });
});

describe("item form (attribute option and option value)", () => {
  it("uses the value-code pattern (a digit may come first), the default locale label and a whole position", () => {
    const base = { ...emptyItemForm(locales), code: "42", label: { uk: "42", en: "" } };
    expect(validateItemForm(base, "create", options)).toEqual({});
    expect(validateItemForm({ ...base, code: "_x" }, "create", options)["code"]?.key).toBe(
      "dict.error.valueCodeFormat",
    );
    expect(
      validateItemForm({ ...base, label: { uk: "", en: "x" } }, "create", options)["label.uk"]?.key,
    ).toBe("errors.reason.default_locale_missing");
    expect(validateItemForm({ ...base, position: "-2" }, "create", options)["position"]?.key).toBe(
      "dict.error.positionInvalid",
    );
    expect(validateItemForm({ ...base, position: "7" }, "create", options)).toEqual({});
  });

  it("sends the position only when typed", () => {
    expect(
      itemCreateBody({ code: "red", label: { uk: "Червоний", en: "" }, position: "" }, locales),
    ).toEqual({
      code: "red",
      label: { uk: "Червоний" },
    });
    expect(
      itemCreateBody({ code: "red", label: { uk: "Червоний", en: "" }, position: "3" }, locales),
    ).toEqual({
      code: "red",
      label: { uk: "Червоний" },
      position: 3,
    });
  });

  it("patches only the label map or the position that changed", () => {
    const initial = itemFormFrom(
      { code: "red", label: { uk: "Червоний", en: "Red" }, position: 2 },
      locales,
    );
    expect(itemPatchBody(initial, structuredClone(initial), locales)).toEqual({});
    expect(itemPatchBody(initial, { ...initial, position: "5" }, locales)).toEqual({ position: 5 });
    expect(
      itemPatchBody(initial, { ...initial, label: { uk: "Червоний", en: "Crimson" } }, locales),
    ).toEqual({
      label: { uk: "Червоний", en: "Crimson" },
    });
  });

  it("an emptied position on edit is left as it was (it cannot be cleared)", () => {
    const initial = itemFormFrom({ code: "red", label: { uk: "Ч", en: "" }, position: 2 }, locales);
    expect(itemPatchBody(initial, { ...initial, position: "" }, locales)).toEqual({});
  });
});

describe("product type form", () => {
  const type: AdminProductType = {
    id: "t1",
    code: "book",
    name: { uk: "Книга", en: "Book" },
    requiresShipping: true,
    ...stamp,
  };

  it("starts requiring shipping, like the API", () => {
    expect(emptyProductTypeForm(locales).requiresShipping).toBe(true);
  });

  it("validates like an option and builds both bodies with the exact API field name", () => {
    expect(
      validateProductTypeForm(emptyProductTypeForm(locales), "create", options)["code"]?.key,
    ).toBe("dict.error.codeFormat");
    expect(
      productTypeCreateBody(
        { code: "ebook", name: { uk: "Е-книга", en: "" }, requiresShipping: false },
        locales,
      ),
    ).toEqual({ code: "ebook", name: { uk: "Е-книга" }, requiresShipping: false });
    const initial = productTypeFormFrom(type, locales);
    expect(productTypePatchBody(initial, structuredClone(initial), locales)).toEqual({});
    expect(productTypePatchBody(initial, { ...initial, requiresShipping: false }, locales)).toEqual(
      {
        requiresShipping: false,
      },
    );
  });
});

describe("assignments", () => {
  it("requires an attribute when adding, a level, and a whole position", () => {
    expect(
      validateAttributeAssignment(
        { attributeId: "", level: "product", isRequired: false, position: "" },
        "add",
      )["attributeId"]?.key,
    ).toBe("dict.error.pickerRequired");
    expect(
      validateAttributeAssignment(
        { attributeId: "a1", level: "variant", isRequired: true, position: "x" },
        "add",
      )["position"]?.key,
    ).toBe("dict.error.positionInvalid");
    expect(
      validateAttributeAssignment(
        { attributeId: "", level: "variant", isRequired: true, position: "" },
        "edit",
      ),
    ).toEqual({});
  });

  it("builds the PUT bodies with level, isRequired and position", () => {
    expect(
      attributeAssignmentBody({
        attributeId: "a1",
        level: "variant",
        isRequired: true,
        position: "4",
      }),
    ).toEqual({
      level: "variant",
      isRequired: true,
      position: 4,
    });
    expect(
      attributeAssignmentBody({
        attributeId: "a1",
        level: "product",
        isRequired: false,
        position: "",
      }),
    ).toEqual({
      level: "product",
      isRequired: false,
    });
    expect(optionAssignmentBody({ optionId: "o1", position: "" })).toEqual({});
    expect(optionAssignmentBody({ optionId: "o1", position: "2" })).toEqual({ position: 2 });
    expect(validateOptionAssignment({ optionId: "", position: "" }, "add")["optionId"]?.key).toBe(
      "dict.error.pickerRequired",
    );
    expect(
      validateOptionAssignment({ optionId: "o", position: "-1" }, "add")["position"]?.key,
    ).toBe("dict.error.positionInvalid");
  });
});

describe("brand form", () => {
  const brand: AdminBrand = {
    id: "b1",
    slug: "acme",
    name: { uk: "Акме", en: "Acme" },
    description: null,
    logoUrl: "https://example.com/acme.png",
    ...stamp,
  };

  it("checks the name, the slug pattern and that the logo is an http(s) URL", () => {
    const form = { ...emptyBrandForm(locales), name: { uk: "Акме", en: "" } };
    expect(validateBrandForm(form, options)).toEqual({});
    expect(validateBrandForm({ ...form, slug: "Not A Slug" }, options)["slug"]?.key).toBe(
      "dict.error.slugFormat",
    );
    expect(
      validateBrandForm({ ...form, logoUrl: "javascript:alert(1)" }, options)["logoUrl"]?.key,
    ).toBe("dict.error.urlInvalid");
    expect(
      validateBrandForm({ ...form, logoUrl: "//evil.example/x.png" }, options)["logoUrl"]?.key,
    ).toBe("dict.error.urlInvalid");
    expect(validateBrandForm({ ...form, logoUrl: "https://example.com/a.png" }, options)).toEqual(
      {},
    );
    expect(validateBrandForm({ ...emptyBrandForm(locales) }, options)["name.uk"]?.key).toBe(
      "errors.reason.default_locale_missing",
    );
  });

  it("leaves empty optional fields out of the create body", () => {
    expect(
      brandCreateBody({ ...emptyBrandForm(locales), name: { uk: "Акме", en: "" } }, locales),
    ).toEqual({
      name: { uk: "Акме" },
    });
    expect(
      brandCreateBody(
        {
          name: { uk: "Акме", en: "" },
          description: { uk: "Опис", en: "" },
          logoUrl: " https://example.com/a.png ",
          slug: "acme",
        },
        locales,
      ),
    ).toEqual({
      name: { uk: "Акме" },
      description: { uk: "Опис" },
      logoUrl: "https://example.com/a.png",
      slug: "acme",
    });
  });

  it("patches only changed fields and clears the logo and the description with null", () => {
    const initial = brandFormFrom(brand, locales);
    expect(brandPatchBody(initial, structuredClone(initial), locales)).toEqual({});
    expect(brandPatchBody(initial, { ...initial, logoUrl: "" }, locales)).toEqual({
      logoUrl: null,
    });
    expect(brandPatchBody(initial, { ...initial, slug: "acme-2" }, locales)).toEqual({
      slug: "acme-2",
    });
    const described = brandFormFrom({ ...brand, description: { uk: "Опис" } }, locales);
    expect(
      brandPatchBody(described, { ...described, description: { uk: "", en: "" } }, locales),
    ).toEqual({
      description: null,
    });
  });

  it("requires a slug on edit (it is always set)", () => {
    const initial = brandFormFrom(brand, locales);
    expect(validateBrandForm({ ...initial, slug: "" }, options, "edit")["slug"]?.key).toBe(
      "errors.reason.required",
    );
    expect(validateBrandForm({ ...initial, slug: "" }, options, "create")).toEqual({});
  });
});

describe("category form", () => {
  const category: AdminCategory = {
    id: "c1",
    parentId: null,
    slug: "shoes",
    name: { uk: "Взуття", en: "Shoes" },
    description: null,
    position: 0,
    isActive: true,
    ...stamp,
  };

  it("creates active by default, under a parent when given, last among its siblings", () => {
    expect(emptyCategoryForm(locales, "p1").parentId).toBe("p1");
    expect(emptyCategoryForm(locales, null).parentId).toBe("");
    expect(emptyCategoryForm(locales, null).isActive).toBe(true);
    const body = categoryCreateBody(
      { ...emptyCategoryForm(locales, "p1"), name: { uk: "Чоботи", en: "" } },
      locales,
    );
    expect(body).toEqual({ name: { uk: "Чоботи" }, parentId: "p1", isActive: true });
    expect(
      categoryCreateBody(
        { ...emptyCategoryForm(locales, null), name: { uk: "Чоботи", en: "" }, slug: "boots" },
        locales,
      ),
    ).toEqual({ name: { uk: "Чоботи" }, slug: "boots", isActive: true });
  });

  it("checks the name and the slug", () => {
    expect(validateCategoryForm(emptyCategoryForm(locales, null), options)["name.uk"]?.key).toBe(
      "errors.reason.default_locale_missing",
    );
    expect(
      validateCategoryForm(
        { ...emptyCategoryForm(locales, null), name: { uk: "К", en: "" }, slug: "A B" },
        options,
      )["slug"]?.key,
    ).toBe("dict.error.slugFormat");
  });

  it("patches name, description, slug and isActive only, and never parentId or position", () => {
    const initial = categoryFormFrom(category, locales);
    expect(categoryPatchBody(initial, structuredClone(initial), locales)).toEqual({});
    expect(categoryPatchBody(initial, { ...initial, isActive: false }, locales)).toEqual({
      isActive: false,
    });
    const patch = categoryPatchBody(
      initial,
      { ...initial, parentId: "other", slug: "boots" },
      locales,
    );
    expect(patch).toEqual({ slug: "boots" });
  });

  it("builds a move body: parentId null for the root, position only when typed", () => {
    expect(moveCategoryBody({ parentId: "", position: "" })).toEqual({ parentId: null });
    expect(moveCategoryBody({ parentId: "p2", position: "1" })).toEqual({
      parentId: "p2",
      position: 1,
    });
    expect(validateMoveForm({ parentId: "", position: "x" })["position"]?.key).toBe(
      "dict.error.positionInvalid",
    );
    expect(validateMoveForm({ parentId: "", position: "0" })).toEqual({});
  });
});
