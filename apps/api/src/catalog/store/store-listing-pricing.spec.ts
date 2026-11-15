import { expect, it } from "vitest";
import { DEFAULT_PRICING_CONFIG } from "../../common/pricing-config.js";
import { priceVariants } from "./store-pricing.js";
import { summarizeListingGroups } from "./store-listing.js";
import type { ListingFact } from "./store-listing.repository.js";
import type { SellableVariantRow } from "./store.repository.js";

function variant(id: string, amount: number, currency = "UAH"): SellableVariantRow {
  return {
    id,
    productId: "p",
    sku: id,
    attributes: {},
    trackInventory: true,
    allowBackorder: false,
    priceAmount: amount,
    priceCurrency: currency,
    compareAtAmount: null,
  };
}

it("excludes foreign-currency prices from a group range, retaining unequal and zero shop prices", () => {
  const variants = [variant("v0", 0), variant("v1", 1234), variant("v2", 9000, "USD")];
  const facts: ListingFact[] = variants.map((variant) => ({
    productId: "p",
    optionCode: "color",
    optionName: { uk: "Color" },
    splitsListing: true,
    variantId: variant.id,
    valueCode: "red",
    valueId: "red",
    valueName: { uk: "Red" },
  }));
  const priced = priceVariants(variants, [], DEFAULT_PRICING_CONFIG);
  const groups = summarizeListingGroups(
    "p",
    variants,
    priced,
    facts,
    { locale: "uk", defaultLocale: "uk" },
    "UAH",
  );
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({
    price: { from: 0, to: 1234, currency: "UAH" },
    availability: "out_of_stock",
    variantIds: ["v0", "v1"],
  });
});

it("fails visibly on corrupt stored money rather than aggregating an invalid group price", () => {
  for (const amount of [-1, 1.5, Number.NaN]) {
    expect(() => priceVariants([variant("invalid", amount)], [], DEFAULT_PRICING_CONFIG)).toThrow(
      RangeError,
    );
  }
});
