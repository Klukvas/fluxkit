import { describe, expect, it } from "vitest";
import { canCreateVariantManually, canDeleteVariant, canRebuildVariants } from "./variant-rules.js";

describe("canDeleteVariant", () => {
  it("allows deleting a non-default variant of a draft product that has other variants", () => {
    expect(
      canDeleteVariant({
        productStatus: "draft",
        isDefault: false,
        variantCount: 2,
        hasStockHistory: false,
        hasOrderLines: false,
      }),
    ).toEqual({
      allowed: true,
    });
  });

  it.each(["active", "archived"] as const)("refuses for a %s product", (productStatus) => {
    expect(
      canDeleteVariant({
        productStatus,
        isDefault: false,
        variantCount: 3,
        hasStockHistory: false,
        hasOrderLines: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "product_not_draft",
    });
  });

  it("refuses to delete the last variant", () => {
    expect(
      canDeleteVariant({
        productStatus: "draft",
        isDefault: false,
        variantCount: 1,
        hasStockHistory: false,
        hasOrderLines: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "last_variant",
    });
  });

  it("refuses to delete the default variant", () => {
    expect(
      canDeleteVariant({
        productStatus: "draft",
        isDefault: true,
        variantCount: 3,
        hasStockHistory: false,
        hasOrderLines: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "default_variant",
    });
  });

  it("treats a count of zero like a last variant", () => {
    expect(
      canDeleteVariant({
        productStatus: "draft",
        isDefault: false,
        variantCount: 0,
        hasStockHistory: false,
        hasOrderLines: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "last_variant",
    });
  });

  it("reports the product status first when several rules are broken", () => {
    expect(
      canDeleteVariant({
        productStatus: "active",
        isDefault: true,
        variantCount: 1,
        hasStockHistory: false,
        hasOrderLines: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "product_not_draft",
    });
  });

  it("reports the last variant before the default variant", () => {
    expect(
      canDeleteVariant({
        productStatus: "draft",
        isDefault: true,
        variantCount: 1,
        hasStockHistory: false,
        hasOrderLines: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "last_variant",
    });
  });

  it("refuses a variant with stock history (R2), whatever the product status", () => {
    for (const productStatus of ["draft", "active", "archived"] as const) {
      const decision = canDeleteVariant({
        productStatus,
        isDefault: false,
        variantCount: 3,
        hasStockHistory: true,
        hasOrderLines: false,
      });
      expect(decision).toEqual({
        allowed: false,
        reason: productStatus === "draft" ? "has_stock_history" : "product_not_draft",
      });
    }
  });

  it("reports the structural rules before the stock history", () => {
    expect(
      canDeleteVariant({
        productStatus: "draft",
        isDefault: true,
        variantCount: 3,
        hasStockHistory: true,
        hasOrderLines: false,
      }),
    ).toEqual({ allowed: false, reason: "default_variant" });
    expect(
      canDeleteVariant({
        productStatus: "draft",
        isDefault: false,
        variantCount: 1,
        hasStockHistory: true,
        hasOrderLines: false,
      }),
    ).toEqual({ allowed: false, reason: "last_variant" });
  });

  it("refuses a variant that an order line refers to (ADR 0020), even without stock history", () => {
    expect(
      canDeleteVariant({
        productStatus: "draft",
        isDefault: false,
        variantCount: 3,
        hasStockHistory: false,
        hasOrderLines: true,
      }),
    ).toEqual({ allowed: false, reason: "has_order_lines" });
  });

  it("reports the structural rules and the stock history before the order lines", () => {
    const base = { variantCount: 3, hasOrderLines: true } as const;
    expect(
      canDeleteVariant({
        ...base,
        productStatus: "active",
        isDefault: false,
        hasStockHistory: false,
      }),
    ).toEqual({ allowed: false, reason: "product_not_draft" });
    expect(
      canDeleteVariant({
        ...base,
        productStatus: "draft",
        isDefault: true,
        hasStockHistory: false,
      }),
    ).toEqual({ allowed: false, reason: "default_variant" });
    expect(
      canDeleteVariant({
        ...base,
        productStatus: "draft",
        isDefault: false,
        hasStockHistory: true,
      }),
    ).toEqual({ allowed: false, reason: "has_stock_history" });
  });

  it("is pure: two calls agree", () => {
    const input = Object.freeze({
      productStatus: "draft" as const,
      isDefault: false,
      variantCount: 2,
      hasStockHistory: false,
      hasOrderLines: false,
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

describe("canRebuildVariants", () => {
  it("allows rebuilding when no variant has stock history", () => {
    expect(
      canRebuildVariants({ anyVariantHasStockHistory: false, anyVariantHasOrderLines: false }),
    ).toEqual({ allowed: true });
  });

  it("refuses when any variant has stock history", () => {
    expect(
      canRebuildVariants({ anyVariantHasStockHistory: true, anyVariantHasOrderLines: false }),
    ).toEqual({
      allowed: false,
      reason: "has_stock_history",
    });
  });

  it("refuses when any variant is referenced by an order line (ADR 0020)", () => {
    expect(
      canRebuildVariants({ anyVariantHasStockHistory: false, anyVariantHasOrderLines: true }),
    ).toEqual({ allowed: false, reason: "has_order_lines" });
  });

  it("reports the stock history before the order lines", () => {
    expect(
      canRebuildVariants({ anyVariantHasStockHistory: true, anyVariantHasOrderLines: true }),
    ).toEqual({ allowed: false, reason: "has_stock_history" });
  });
});
