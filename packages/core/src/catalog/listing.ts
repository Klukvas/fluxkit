import { isVariantSellable } from "./sellable.js";
import type { OptionValuePair, ProductStatus } from "./types.js";
import { checkOptionCoverage } from "./variants.js";
import { isValidCode, isValidValueCode } from "./limits.js";

export interface ListingVariant {
  readonly isActive: boolean;
  readonly hasShopPrice: boolean;
  readonly optionValues: readonly OptionValuePair[];
}

export interface ListingGroup<T> {
  readonly listingKey: string;
  readonly listingOption: OptionValuePair | null;
  readonly variants: readonly T[];
}

/** Codes exclude the delimiter; labels and representative variant ids never determine card identity. */
export function deriveListingKey(productId: string, option: OptionValuePair | null): string {
  if (productId.length === 0 || productId.includes(":")) {
    throw new Error("Invalid listing product id.");
  }
  if (option === null) return productId;
  if (!isValidCode(option.optionCode) || !isValidValueCode(option.valueCode)) {
    throw new Error("Invalid listing option or value code.");
  }
  return `${productId}:${option.optionCode}:${option.valueCode}`;
}

/**
 * Partitions sellable variants in input order; stock does not affect eligibility. The split code belongs to this
 * product's type assignment. A product which did not choose that option keeps one base group. No prices are aggregated.
 */
export function partitionListingVariants<T extends ListingVariant>(input: {
  readonly productId: string;
  readonly productStatus: ProductStatus;
  readonly optionCodes: readonly string[];
  readonly splitOptionCode: string | null;
  readonly variants: readonly T[];
}): readonly ListingGroup<T>[] {
  const splitCode =
    input.splitOptionCode !== null && input.optionCodes.includes(input.splitOptionCode)
      ? input.splitOptionCode
      : null;
  // Validate all stored variants, including inactive ones: corrupt coverage must fail visibly before a build.
  const violations = checkOptionCoverage(input.optionCodes, input.variants);
  if (violations.length > 0) {
    throw new Error(`Invalid listing variant option coverage: ${JSON.stringify(violations)}.`);
  }
  const groups = new Map<string, ListingGroup<T>>();
  for (const variant of input.variants) {
    if (
      !isVariantSellable({
        productStatus: input.productStatus,
        variantIsActive: variant.isActive,
        hasShopPrice: variant.hasShopPrice,
      })
    )
      continue;
    const listingOption =
      splitCode === null
        ? null
        : variant.optionValues.find((entry) => entry.optionCode === splitCode);
    if (listingOption === undefined) {
      throw new Error("Invalid listing variant: missing split option value.");
    }
    const listingKey = deriveListingKey(input.productId, listingOption);
    const previous = groups.get(listingKey);
    groups.set(listingKey, {
      listingKey,
      listingOption,
      variants: [...(previous?.variants ?? []), variant],
    });
  }
  return [...groups.values()];
}
