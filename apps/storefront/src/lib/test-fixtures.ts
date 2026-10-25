import type {
  Availability,
  Cart,
  CartLine,
  Customer,
  CategoryNode,
  ProductDetail,
  ProductOption,
  ProductSummary,
  ProductVariant,
  ShippingOption,
  ShippingOptions,
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
    brand: { slug: "demo-brand", name: "§brand" },
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
    brand: { slug: "demo-brand", name: "§brand" },
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

export function cartLine(variantId: string, overrides: Partial<CartLine> = {}): CartLine {
  return {
    variantId,
    productSlug: `product-${variantId}`,
    sku: `SKU-${variantId}`,
    title: `Title of ${variantId}`,
    variantTitle: null,
    optionValues: [],
    image: null,
    quantity: 1,
    unitPrice: { amount: 1999, currency: "UAH" },
    compareAtAmount: null,
    lineTotal: { amount: 1999, currency: "UAH" },
    availability: "in_stock",
    notices: [],
    ...overrides,
  };
}

/** Totals are given, never computed: the storefront never adds money and neither do its fixtures. */
export function cartOf(lines: CartLine[], overrides: Partial<Cart> = {}): Cart {
  return {
    lines,
    subtotal: { amount: 1999, currency: "UAH" },
    total: { amount: 1999, currency: "UAH" },
    itemCount: lines.reduce((count, line) => count + line.quantity, 0),
    purchasable: lines.length > 0,
    requiresShipping: true,
    notices: [],
    ...overrides,
  };
}

export function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "customer-1",
    email: "shopper@example.test",
    firstName: "Ada",
    lastName: "Shopper",
    phone: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * A shipping option as `GET /store/shipping/options` returns it: the amounts are GIVEN here (never computed), so a test can
 * make `total` differ from anything the code under test could add up.
 */
export function shippingOption(
  methodCode: string,
  overrides: Partial<ShippingOption> = {},
): ShippingOption {
  return {
    methodCode,
    kind: "address",
    title: `Title of ${methodCode}`,
    description: null,
    providerCode: null,
    countryCodes: ["UA"],
    available: true,
    price: { amount: 5000, currency: "UAH" },
    payer: "shop_charge",
    total: { amount: 6999, currency: "UAH" },
    estimate: null,
    ...overrides,
  };
}

export function shippingOptionsOf(
  options: ShippingOption[],
  subtotal: ShippingOptions["subtotal"] = { amount: 1999, currency: "UAH" },
): ShippingOptions {
  return { subtotal, options };
}
