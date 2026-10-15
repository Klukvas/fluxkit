import { validateAttributeValues } from "./attribute-values.js";
import { validateI18nText } from "./i18n.js";
import { TEXT_LIMITS } from "./limits.js";
import { isValidSku } from "./sku.js";
import { validateSlug } from "./slug.js";
import type {
  AttributeLevel,
  LocaleConfig,
  ProductSnapshot,
  ProductStatus,
  ProductTypeDefinition,
} from "./types.js";
import { checkVariantInvariants } from "./variants.js";

const TRANSITIONS: Readonly<Record<ProductStatus, readonly ProductStatus[]>> = {
  draft: ["active", "archived"],
  active: ["draft", "archived"],
  archived: ["draft"],
};

/**
 * Allowed status changes (ADR 0006 section 6): publish, unpublish, archive from draft or active,
 * and restore from archived to draft. Restoring straight to active is not allowed because the
 * publish preconditions must run again.
 */
export function canTransition(from: ProductStatus, to: ProductStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A product may be deleted for good only if it was never published. */
export function canHardDelete(product: Pick<ProductSnapshot, "publishedAt">): boolean {
  return product.publishedAt === null;
}

export type PublishViolationCode =
  | "title_invalid"
  | "slug_missing"
  | "slug_invalid"
  | "no_variants"
  | "no_default_variant"
  | "multiple_default_variants"
  | "default_variant_inactive"
  | "no_active_variant"
  | "missing_option_value"
  | "unexpected_option_value"
  | "duplicate_option_value"
  | "duplicate_option_signature"
  | "signature_mismatch"
  | "variant_sku_invalid"
  | "duplicate_sku"
  | "attribute_invalid"
  | "option_not_allowed";

export interface PublishViolation {
  readonly code: PublishViolationCode;
  /** Machine-readable detail from the underlying check (for example `default_locale_missing`). */
  readonly reason?: string;
  readonly locale?: string;
  readonly variantIndex?: number;
  readonly attributeCode?: string;
  readonly level?: AttributeLevel;
  readonly optionCode?: string;
  readonly signature?: string;
}

function checkSku(sku: string): "empty" | "too_long" | "invalid_format" | null {
  if (isValidSku(sku)) {
    return null;
  }
  if (sku.length === 0) {
    return "empty";
  }
  return sku.length > TEXT_LIMITS.sku ? "too_long" : "invalid_format";
}

/**
 * Every reason a product cannot be published right now (ADR 0006 section 6), all at once. An empty
 * list means publishing is allowed. Whether the status transition itself is legal is `canTransition`.
 */
export function publishPreconditions(
  product: ProductSnapshot,
  productType: ProductTypeDefinition,
  config: LocaleConfig,
): PublishViolation[] {
  const violations: PublishViolation[] = [];

  const title = validateI18nText(product.title, {
    defaultLocale: config.defaultLocale,
    locales: config.locales,
    maxLength: TEXT_LIMITS.title,
    required: true,
  });
  if (!title.ok) {
    for (const error of title.errors) {
      violations.push({
        code: "title_invalid",
        reason: error.reason,
        ...(error.locale !== undefined && { locale: error.locale }),
      });
    }
  }

  const slug = validateSlug(product.slug);
  if (!slug.ok) {
    violations.push(
      slug.reason === "empty"
        ? { code: "slug_missing" }
        : { code: "slug_invalid", reason: slug.reason },
    );
  }

  violations.push(...checkVariantInvariants(product.optionCodes, product.variants));

  if (product.variants.length > 0) {
    product.variants.forEach((variant, variantIndex) => {
      if (variant.isDefault && !variant.isActive) {
        violations.push({ code: "default_variant_inactive", variantIndex });
      }
    });
    if (!product.variants.some((variant) => variant.isActive)) {
      violations.push({ code: "no_active_variant" });
    }
  }

  const seenSkus = new Set<string>();
  product.variants.forEach((variant, variantIndex) => {
    const skuProblem = checkSku(variant.sku);
    if (skuProblem !== null) {
      violations.push({ code: "variant_sku_invalid", variantIndex, reason: skuProblem });
    }
    if (seenSkus.has(variant.sku)) {
      violations.push({ code: "duplicate_sku", variantIndex });
    }
    seenSkus.add(variant.sku);
  });

  const options = { mode: "publish" as const, ...config };
  const productAttributes = validateAttributeValues(
    productType,
    "product",
    product.attributes,
    options,
  );
  if (!productAttributes.ok) {
    for (const error of productAttributes.errors) {
      violations.push(attributeViolation("product", error));
    }
  }
  product.variants.forEach((variant, variantIndex) => {
    const result = validateAttributeValues(productType, "variant", variant.attributes, options);
    if (!result.ok) {
      for (const error of result.errors) {
        violations.push({ ...attributeViolation("variant", error), variantIndex });
      }
    }
  });

  for (const optionCode of product.optionCodes) {
    if (!productType.allowedOptionCodes.includes(optionCode)) {
      violations.push({ code: "option_not_allowed", optionCode });
    }
  }

  return violations;
}

function attributeViolation(
  level: AttributeLevel,
  error: { readonly attributeCode: string | null; readonly reason: string; readonly locale?: string },
): PublishViolation {
  return {
    code: "attribute_invalid",
    level,
    ...(error.attributeCode !== null && { attributeCode: error.attributeCode }),
    reason: error.reason,
    ...(error.locale !== undefined && { locale: error.locale }),
  };
}
