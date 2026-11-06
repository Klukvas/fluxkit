import type { I18nText } from "@fluxkit/core";
import type { SeedMedia, SeedProduct, SeedVariantCommerce } from "../types.js";

/** Folder of the coffee pictures inside `seeds/assets/` (drawn by `scripts/generate-coffee-images.mjs`). */
export const COFFEE_ASSETS_FOLDER = "coffee";

/** Price and stock of one variant, without its option values and SKU (the builder adds them). */
export type Commerce = Omit<SeedVariantCommerce, "optionValues" | "sku">;

/**
 * One product of the coffee demo, in a compact form. `options` lists `[option code, value codes]` in display order; the
 * builder generates every combination (as the admin API does) and looks up `variants[key]`, where `key` is the value codes
 * joined by `/` in that order (`"350ml/50"`), or `""` for a product without options. A combination without an entry is a bug
 * in the data and fails loudly when the module loads.
 */
export interface CoffeeProductSpec {
  slug: string;
  /** Upper-case SKU stem; each variant's SKU is the stem plus its value codes (`CUP-DW-KR-350ML-25`). */
  sku: string;
  title: I18nText;
  description: I18nText;
  type: string;
  brand: string;
  /** The first one is the primary category. */
  categories: readonly string[];
  attributes?: Readonly<Record<string, unknown>>;
  options?: readonly (readonly [string, readonly string[]])[];
  variants: Readonly<Record<string, Commerce>>;
  /** Extra pictures after the main one (`<slug>.webp`), each a file in the coffee folder with its own alt text. */
  extraImages?: readonly { file: string; alt: I18nText }[];
  /** Alt text of the main picture; the title when omitted. */
  alt?: I18nText;
}

function combinations(
  options: readonly (readonly [string, readonly string[]])[],
): Record<string, string>[] {
  let result: Record<string, string>[] = [{}];
  for (const [code, values] of options) {
    result = result.flatMap((partial) => values.map((value) => ({ ...partial, [code]: value })));
  }
  return result;
}

export function coffeeProduct(spec: CoffeeProductSpec): SeedProduct {
  const options = spec.options ?? [];
  const known = new Set<string>();
  const variants = combinations(options).map((optionValues) => {
    const codes = options.map(([code]) => optionValues[code] ?? "");
    const key = codes.join("/");
    known.add(key);
    const commerce = spec.variants[key];
    if (commerce === undefined) {
      throw new Error(`Coffee seed: product "${spec.slug}" has no price for the variant "${key}".`);
    }
    return {
      optionValues,
      sku: [spec.sku, ...codes.map((code) => code.toUpperCase())].join("-"),
      ...commerce,
    } satisfies SeedVariantCommerce;
  });
  for (const key of Object.keys(spec.variants)) {
    if (!known.has(key)) {
      throw new Error(
        `Coffee seed: product "${spec.slug}" prices a variant "${key}" its options do not generate.`,
      );
    }
  }
  const media: SeedMedia[] = [
    { file: `${COFFEE_ASSETS_FOLDER}/${spec.slug}.webp`, alt: spec.alt ?? spec.title },
    ...(spec.extraImages ?? []).map((image) => ({
      file: `${COFFEE_ASSETS_FOLDER}/${image.file}.webp`,
      alt: image.alt,
    })),
  ];
  return {
    slug: spec.slug,
    title: spec.title,
    description: spec.description,
    productTypeCode: spec.type,
    brandSlug: spec.brand,
    categorySlugs: spec.categories,
    attributes: spec.attributes ?? {},
    options: options.map(([optionCode, valueCodes]) => ({ optionCode, valueCodes })),
    media,
    variants,
  };
}

/**
 * Price (minor units) and stock of one variant: `stock` units on hand, `0` = tracked and sold out, `undefined` = untracked
 * (digital goods).
 */
export function v(
  amount: number,
  stock: number | undefined,
  extra: Partial<Commerce> = {},
): Commerce {
  return { amount, ...(stock === undefined ? {} : { stock }), ...extra };
}

/** Shorthand for a bilingual text. */
export function t(uk: string, en: string): I18nText {
  return { uk, en };
}
