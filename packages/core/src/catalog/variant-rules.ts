import type { ProductStatus } from "./types.js";

export type VariantRuleReason =
  "product_not_draft" | "last_variant" | "default_variant" | "has_stock_history";

export type VariantRuleDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: VariantRuleReason };

const ALLOWED: VariantRuleDecision = Object.freeze({ allowed: true });

function forbid(reason: VariantRuleReason): VariantRuleDecision {
  return { allowed: false, reason };
}

/**
 * Hard-deleting a variant (ADR 0006 sections 3 and 5, ADR 0013): only while the product is a draft, never the
 * last variant, never the default one, and never one with stock history (any `stock_movement` or `reservation` row,
 * whatever its status), because deleting the variant would cascade the history away. After publishing, or once the
 * variant has stock history, it is switched off instead.
 */
export function canDeleteVariant(facts: {
  readonly productStatus: ProductStatus;
  readonly isDefault: boolean;
  readonly variantCount: number;
  readonly hasStockHistory: boolean;
}): VariantRuleDecision {
  if (facts.productStatus !== "draft") {
    return forbid("product_not_draft");
  }
  if (facts.variantCount <= 1) {
    return forbid("last_variant");
  }
  if (facts.isDefault) {
    return forbid("default_variant");
  }
  if (facts.hasStockHistory) {
    return forbid("has_stock_history");
  }
  return ALLOWED;
}

/** Variants created by hand (not by generation) change the option structure, so draft only. */
export function canCreateVariantManually(productStatus: ProductStatus): VariantRuleDecision {
  return productStatus === "draft" ? ALLOWED : forbid("product_not_draft");
}

/**
 * Rebuilding all variants of a draft product (a change of its options that adds or removes an option or removes a
 * value, ADR 0014) deletes every variant and so cascades their stock history away. It is refused while any variant
 * of the product has stock history (same definition as `canDeleteVariant`, ADR 0013).
 */
export function canRebuildVariants(facts: {
  readonly anyVariantHasStockHistory: boolean;
}): VariantRuleDecision {
  return facts.anyVariantHasStockHistory ? forbid("has_stock_history") : ALLOWED;
}
