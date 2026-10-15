import type { ProductStatus } from "./types.js";

export type VariantRuleReason = "product_not_draft" | "last_variant" | "default_variant";

export type VariantRuleDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: VariantRuleReason };

const ALLOWED: VariantRuleDecision = Object.freeze({ allowed: true });

function forbid(reason: VariantRuleReason): VariantRuleDecision {
  return { allowed: false, reason };
}

/**
 * Hard-deleting a variant (ADR 0006 sections 3 and 5): only while the product is a draft, never the
 * last variant and never the default one. After publishing, a variant is switched off instead.
 */
export function canDeleteVariant(facts: {
  readonly productStatus: ProductStatus;
  readonly isDefault: boolean;
  readonly variantCount: number;
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
  return ALLOWED;
}

/** Variants created by hand (not by generation) change the option structure, so draft only. */
export function canCreateVariantManually(productStatus: ProductStatus): VariantRuleDecision {
  return productStatus === "draft" ? ALLOWED : forbid("product_not_draft");
}
