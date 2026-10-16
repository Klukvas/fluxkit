import { describe, expect, it } from "vitest";
import { isVariantSellable } from "./sellable.js";
import type { ProductStatus } from "./types.js";

describe("isVariantSellable", () => {
  const statuses: ProductStatus[] = ["draft", "active", "archived"];

  it("is true only for an active variant, with a shop-currency price, of an active product", () => {
    for (const productStatus of statuses) {
      for (const variantIsActive of [true, false]) {
        for (const hasShopPrice of [true, false]) {
          expect(
            isVariantSellable({ productStatus, variantIsActive, hasShopPrice }),
            `${productStatus} / active ${variantIsActive} / priced ${hasShopPrice}`,
          ).toBe(productStatus === "active" && variantIsActive && hasShopPrice);
        }
      }
    }
  });

  it("is false for an active variant of a live product that has no shop price (R7)", () => {
    expect(
      isVariantSellable({ productStatus: "active", variantIsActive: true, hasShopPrice: false }),
    ).toBe(false);
  });
});
