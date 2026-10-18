import type {
  Availability,
  CategoryNode,
  ProductDetail,
  ProductOption,
  ProductSummary,
  ProductVariant,
} from "@fluxkit/api-client";

/**
 * API-shaped data for tests (storefront and its components). The option and value codes are DATA here, as they are in the
 * API: the code under test must work for any niche, so several specs use a second, unrelated set (`flavor`, `pack`).
 */

export function option(code: string, valueCodes: readonly string[]): ProductOption {
  return {
    id: `option-${code}`,
    code,
    name: `Name of ${code}`,
    values: valueCodes.map((valueCode) => ({
      id: `value-${code}-${valueCode}`,
      code: valueCode,
      name: `Name of ${valueCode}`,
    })),
  };
}

export function variant(
  id: string,
  values: Record<string, string>,
  overrides: Partial<Pick<ProductVariant, "availability" | "price" | "sku">> = {},
): ProductVariant {
  return {
    id,
    sku: overrides.sku ?? `SKU-${id}`,
    optionValues: Object.entries(values).map(([optionCode, valueCode]) => ({
      optionCode,
      valueCode,
    })),
    attributes: {},
    price: overrides.price ?? { amount: 1999, currency: "UAH", compareAtAmount: null },
    availability: overrides.availability ?? "in_stock",
  };
}

export function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: "product-1",
    slug: "demo-product",
    title: "Demo product",
    description: "A demo product.",
    brand: { slug: "demo-brand", name: "Demo brand" },
    publishedAt: "2026-10-01T10:00:00.000Z",
    categories: [],
    attributes: {},
    attributeDefinitions: [],
    options: [],
    variants: [variant("v1", {})],
    media: [],
    price: { from: 1999, to: 1999, currency: "UAH" },
    availability: "in_stock",
    ...overrides,
  };
}

export function summary(
  slug: string,
  overrides: Partial<ProductSummary> = {},
  availability: Availability = "in_stock",
): ProductSummary {
  return {
    id: `id-${slug}`,
    slug,
    title: `Title of ${slug}`,
    brand: { slug: "demo-brand", name: "Demo brand" },
    image: null,
    publishedAt: "2026-10-01T10:00:00.000Z",
    price: { from: 1999, to: 1999, currency: "UAH" },
    availability,
    ...overrides,
  };
}

export function category(
  slug: string,
  children: CategoryNode[] = [],
  overrides: Partial<CategoryNode> = {},
): CategoryNode {
  return {
    id: `category-${slug}`,
    slug,
    name: `Name of ${slug}`,
    description: null,
    children,
    ...overrides,
  };
}
