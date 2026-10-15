import { describe, expect, it } from "vitest";
import { canCreateVariantManually, canDeleteVariant } from "./variant-rules.js";

describe("canDeleteVariant", () => {
  it("allows deleting a non-default variant of a draft product that has other variants", () => {
    expect(canDeleteVariant({ productStatus: "draft", isDefault: false, variantCount: 2 })).toEqual(
      {
        allowed: true,
      },
    );
  });

  it.each(["active", "archived"] as const)("refuses for a %s product", (productStatus) => {
    expect(canDeleteVariant({ productStatus, isDefault: false, variantCount: 3 })).toEqual({
      allowed: false,
      reason: "product_not_draft",
    });
  });

  it("refuses to delete the last variant", () => {
    expect(canDeleteVariant({ productStatus: "draft", isDefault: false, variantCount: 1 })).toEqual(
      {
        allowed: false,
        reason: "last_variant",
      },
    );
  });

  it("refuses to delete the default variant", () => {
    expect(canDeleteVariant({ productStatus: "draft", isDefault: true, variantCount: 3 })).toEqual({
      allowed: false,
      reason: "default_variant",
    });
  });

  it("treats a count of zero like a last variant", () => {
    expect(canDeleteVariant({ productStatus: "draft", isDefault: false, variantCount: 0 })).toEqual(
      {
        allowed: false,
        reason: "last_variant",
      },
    );
  });

  it("reports the product status first when several rules are broken", () => {
    expect(canDeleteVariant({ productStatus: "active", isDefault: true, variantCount: 1 })).toEqual(
      {
        allowed: false,
        reason: "product_not_draft",
      },
    );
  });

  it("reports the last variant before the default variant", () => {
    expect(canDeleteVariant({ productStatus: "draft", isDefault: true, variantCount: 1 })).toEqual({
      allowed: false,
      reason: "last_variant",
    });
  });

  it("is pure: two calls agree", () => {
    const input = Object.freeze({
      productStatus: "draft" as const,
      isDefault: false,
      variantCount: 2,
    });
    expect(canDeleteVariant(input)).toEqual(canDeleteVariant(input));
  });
});

describe("canCreateVariantManually", () => {
  it("allows a draft product", () => {
    expect(canCreateVariantManually("draft")).toEqual({ allowed: true });
  });

  it.each(["active", "archived"] as const)("refuses a %s product", (status) => {
    expect(canCreateVariantManually(status)).toEqual({
      allowed: false,
      reason: "product_not_draft",
    });
  });
});
