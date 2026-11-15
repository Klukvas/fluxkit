import { partitionListingVariants, type StoreLocale } from "@fluxkit/core";
import type { ListingFact } from "./store-listing.repository.js";
import { summarizeProduct, type StoreVariantPricing } from "./store-pricing.js";
import type { SellableVariantRow } from "./store.repository.js";
import { requiredText } from "./store.serializer.js";
import type { PricingConfig } from "../../common/pricing-config.js";

/** Partitions current sellable facts with core's key rules, then reuses the existing money/availability aggregation. */
export function summarizeListingGroups(
  productId: string,
  variants: readonly SellableVariantRow[],
  priced: ReadonlyMap<string, StoreVariantPricing>,
  facts: readonly ListingFact[],
  locale: StoreLocale,
  currency: PricingConfig["shopCurrency"],
) {
  const chosen = facts.filter((fact) => fact.productId === productId);
  const groups = partitionListingVariants({
    productId,
    productStatus: "active",
    optionCodes: [...new Set(chosen.map((fact) => fact.optionCode))],
    splitOptionCode: chosen.find((fact) => fact.splitsListing === true)?.optionCode ?? null,
    variants: variants
      .filter((variant) => variant.productId === productId)
      .map((variant) => ({
        ...variant,
        isActive: true,
        hasShopPrice: priced.has(variant.id),
        optionValues: chosen.flatMap((fact) =>
          fact.variantId === variant.id && fact.valueCode !== null
            ? [{ optionCode: fact.optionCode, valueCode: fact.valueCode }]
            : [],
        ),
      })),
  });
  return groups.flatMap((group) => {
    const summary = summarizeProduct(
      group.variants.flatMap((variant) => priced.get(variant.id) ?? []),
      currency,
    );
    if (summary === undefined) return [];
    const pair = group.listingOption;
    const definition =
      pair === null
        ? undefined
        : chosen.find(
            (fact) => fact.optionCode === pair.optionCode && fact.valueCode === pair.valueCode,
          );
    if (pair !== null && (definition?.valueName == null || definition.valueId === null))
      throw new Error("Missing listing option definition.");
    return [
      {
        ...summary,
        listingKey: group.listingKey,
        listingOption:
          pair === null || definition?.valueName == null
            ? null
            : {
                ...pair,
                optionName: requiredText(definition.optionName, locale, "Listing option name"),
                valueName: requiredText(definition.valueName, locale, "Listing value name"),
              },
        optionValueId: definition?.valueId ?? null,
        variantIds: group.variants.map((variant) => variant.id),
      },
    ];
  });
}
