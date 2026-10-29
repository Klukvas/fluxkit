import { Inject, Injectable } from "@nestjs/common";
import { exponentOf, type StoreLocale } from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../common/locale.js";
import { PRICING_CONFIG, type PricingConfig } from "../../common/pricing-config.js";
import { SEARCH_PORT, type SearchPort } from "../../common/search-port.js";
import { EmailProviderRegistry, type EmailProviderSource } from "../../email/registry/index.js";
import {
  PaymentProviderRegistry,
  type PaymentProviderSource,
} from "../../payments/registry/index.js";
import { toPage, type Page } from "../../common/pagination.js";
import { notFound, validationFailed } from "../../common/problem.js";
import {
  flattenCategories,
  subtreeIds,
  visibleCategoryTree,
  type VisibleCategory,
} from "./store-categories.js";
import {
  priceVariants,
  summarizeProduct,
  type StoreProductPricing,
  type StoreVariantPricing,
} from "./store-pricing.js";
import {
  optionalText,
  requiredText,
  serializeAttributeDefinitions,
  serializeAttributes,
} from "./store.serializer.js";
import {
  StoreRepository,
  type ProductDetailRow,
  type ProductListRow,
  type ProductMediaRow,
  type SellableVariantRow,
} from "./store.repository.js";
import type {
  StoreCategoryNode,
  StoreConfig,
  StoreProductDetail,
  StoreProductListItem,
  StoreProductsQuery,
} from "./store.schemas.js";
import { isStoreSlug } from "./store.schemas.js";

/** A product row of an active product always has `published_at` (CHECK `product_published_at_check`). */
function publishedAtOf(row: { publishedAt: Date | null; slug: string }): string {
  if (row.publishedAt === null) {
    throw new Error(
      `Active product "${row.slug}" has no published_at, which the database forbids.`,
    );
  }
  return row.publishedAt.toISOString();
}

/** The `price` and `availability` fields of one sellable variant; the caller only passes ids `priceVariants` kept. */
function pricingOf(priced: ReadonlyMap<string, StoreVariantPricing>, variantId: string) {
  const entry = priced.get(variantId);
  if (entry === undefined) {
    throw new Error(`Variant ${variantId} was listed as sellable but has no price.`);
  }
  return {
    price: {
      amount: entry.price.amount,
      currency: entry.price.currency,
      compareAtAmount: entry.price.compareAtAmount,
    },
    availability: entry.availability,
  };
}

/** The list image: the first gallery image (no option pair), else the first image of any kind. */
export function pickListImage(media: readonly ProductMediaRow[], locale: StoreLocale) {
  const chosen = media.find((entry) => entry.optionValueId === null) ?? media[0];
  return chosen === undefined ? null : { url: chosen.url, alt: optionalText(chosen.alt, locale) };
}

function toBrand(
  row: { brandSlug: string | null; brandName: ProductListRow["brandName"] },
  locale: StoreLocale,
) {
  return row.brandSlug === null || row.brandName === null
    ? null
    : {
        slug: row.brandSlug,
        name: requiredText(row.brandName, locale, `Brand "${row.brandSlug}" name`),
      };
}

/** Public catalog reads. Rules of the store contract live here and in the serializer; the repository only queries. */
@Injectable()
export class StoreService {
  constructor(
    private readonly store: StoreRepository,
    @Inject(LOCALE_CONFIG) private readonly config: LocaleConfig,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
    @Inject(EmailProviderRegistry) private readonly email: EmailProviderSource,
    @Inject(PaymentProviderRegistry) private readonly payments: PaymentProviderSource,
    @Inject(SEARCH_PORT) private readonly search: SearchPort,
  ) {}

  /** What the storefront needs to format money and pick a language; nothing else (no thresholds, no internals). */
  getConfig(): StoreConfig {
    return {
      currency: this.pricing.shopCurrency,
      currencyExponent: exponentOf(this.pricing.shopCurrency),
      pricesIncludeTax: this.pricing.pricesIncludeTax,
      defaultLocale: this.config.defaultLocale,
      locales: [...this.config.locales],
      emailDelivery: this.email.deliveryEnabled(),
      onlinePayment: this.payments.onlineEnabled(),
      search: this.search.enabled,
    };
  }

  /** `?locale=` must be configured; missing means the default locale. Fallback to the default is per field. */
  resolveLocale(requested: string | undefined): StoreLocale {
    const locale = requested ?? this.config.defaultLocale;
    if (!this.config.locales.includes(locale)) {
      throw validationFailed([
        {
          path: "locale",
          code: "invalid_value",
          message: `Must be one of: ${this.config.locales.join(", ")}.`,
        },
      ]);
    }
    return { locale, defaultLocale: this.config.defaultLocale };
  }

  async listCategories(
    requestedLocale: string | undefined,
  ): Promise<{ items: StoreCategoryNode[] }> {
    const locale = this.resolveLocale(requestedLocale);
    const tree = visibleCategoryTree(await this.store.listActiveCategories());
    const toNode = (node: VisibleCategory): StoreCategoryNode => ({
      id: node.row.id,
      slug: node.row.slug,
      name: requiredText(node.row.name, locale, `Category "${node.row.slug}" name`),
      description: optionalText(node.row.description, locale),
      children: node.children.map(toNode),
    });
    return { items: tree.map(toNode) };
  }

  async listProducts(query: StoreProductsQuery): Promise<Page<StoreProductListItem>> {
    const locale = this.resolveLocale(query.locale);
    let categoryIds: string[] | undefined;
    if (query.category !== undefined) {
      const tree = visibleCategoryTree(await this.store.listActiveCategories());
      categoryIds = subtreeIds(tree, query.category);
      if (categoryIds.length === 0) {
        // Unknown, inactive or hidden category: an empty list, not an error (and no product query).
        return toPage([], 0, query);
      }
    }
    const { rows, total } = await this.store.listProducts(
      { categoryIds, brandSlug: query.brand, shopCurrency: this.pricing.shopCurrency },
      query,
    );
    return toPage(await this.toListItems(rows, locale), total, query);
  }

  /** The list items of product rows: three batched reads for the whole page, whatever its size. */
  private async toListItems(
    rows: readonly ProductListRow[],
    locale: StoreLocale,
  ): Promise<StoreProductListItem[]> {
    const productIds = rows.map((row) => row.id);
    // Three batched reads for the whole page, whatever its size.
    const [media, variants, levels] = await Promise.all([
      this.store.listMediaForProducts(productIds),
      this.store.listSellableVariants(productIds, this.pricing.shopCurrency),
      this.store.listStockLevels(productIds),
    ]);
    const pricedVariants = priceVariants(variants, levels, this.pricing);
    const items = rows.flatMap((row) => {
      const summary = summarizeProduct(
        variants
          .filter((entry) => entry.productId === row.id)
          .flatMap((entry) => pricedVariants.get(entry.id) ?? []),
        this.pricing.shopCurrency,
      );
      // The product lost its last sellable variant between the page query and this one: it is no longer for sale.
      if (summary === undefined) {
        return [];
      }
      return [
        {
          id: row.id,
          slug: row.slug,
          title: requiredText(row.title, locale, `Product "${row.slug}" title`),
          brand: toBrand(row, locale),
          image: pickListImage(
            media.filter((entry) => entry.productId === row.id),
            locale,
          ),
          publishedAt: publishedAtOf(row),
          ...summary,
        },
      ];
    });
    return items;
  }

  /**
   * List items of the given products in the given order, for the search routes (ADR 0034 decision 10: items are hydrated
   * from Postgres). The same rules as `listProducts`: only active products with a sellable variant; `missing` holds the
   * ids that are not for sale any more (or never were).
   */
  async listItemsByIds(
    productIds: readonly string[],
    requestedLocale: string,
  ): Promise<{ items: StoreProductListItem[]; missing: string[] }> {
    const locale = this.resolveLocale(requestedLocale);
    if (productIds.length === 0) {
      return { items: [], missing: [] };
    }
    const rows = await this.store.listProductsByIds(productIds, this.pricing.shopCurrency);
    const items = await this.toListItems(rows, locale);
    const byId = new Map(items.map((item) => [item.id, item]));
    return {
      items: productIds.flatMap((id) => {
        const item = byId.get(id);
        return item === undefined ? [] : [item];
      }),
      missing: productIds.filter((id) => !byId.has(id)),
    };
  }

  async getProduct(slug: string, requestedLocale: string | undefined): Promise<StoreProductDetail> {
    const locale = this.resolveLocale(requestedLocale);
    if (!isStoreSlug(slug)) {
      // Not a possible slug (and NUL would be rejected by Postgres as a 500): no such product, no query.
      throw notFound("Product");
    }
    const row = await this.store.findActiveProductBySlug(slug, this.pricing.shopCurrency);
    if (row === undefined) {
      throw notFound("Product");
    }
    // Independent reads, a fixed number for any product size: nothing here runs per variant, option or image.
    const [
      assignments,
      activeCategories,
      categoryIds,
      options,
      optionValues,
      variants,
      variantOptionValues,
      media,
      levels,
    ] = await Promise.all([
      this.store.listTypeAttributes(row.productTypeId),
      this.store.listActiveCategories(),
      this.store.listCategoryIds(row.id),
      this.store.listProductOptions(row.id),
      this.store.listProductOptionValues(row.id),
      this.store.listSellableVariants([row.id], this.pricing.shopCurrency),
      this.store.listActiveVariantOptionValues(row.id),
      this.store.listMediaForProducts([row.id]),
      this.store.listStockLevels([row.id]),
    ]);
    const pricedVariants = priceVariants(variants, levels, this.pricing);
    const sellable = variants.filter((entry) => pricedVariants.has(entry.id));
    const summary = summarizeProduct(
      sellable.flatMap((entry) => pricedVariants.get(entry.id) ?? []),
      this.pricing.shopCurrency,
    );
    if (summary === undefined) {
      // The last sellable variant went away after the product row was read: the product is not for sale any more.
      throw notFound("Product");
    }
    const sellableIds = new Set(sellable.map((entry) => entry.id));
    return this.toDetail(row, locale, {
      assignments,
      visibleCategories: flattenCategories(visibleCategoryTree(activeCategories)),
      categoryIds,
      options,
      optionValues,
      variants: sellable,
      pricedVariants,
      summary,
      variantOptionValues: variantOptionValues.filter((entry) => sellableIds.has(entry.variantId)),
      media,
    });
  }

  private toDetail(
    row: ProductDetailRow,
    locale: StoreLocale,
    loaded: {
      assignments: Awaited<ReturnType<StoreRepository["listTypeAttributes"]>>;
      visibleCategories: Awaited<ReturnType<StoreRepository["listActiveCategories"]>>;
      categoryIds: string[];
      options: Awaited<ReturnType<StoreRepository["listProductOptions"]>>;
      optionValues: Awaited<ReturnType<StoreRepository["listProductOptionValues"]>>;
      variants: SellableVariantRow[];
      pricedVariants: Map<string, StoreVariantPricing>;
      summary: StoreProductPricing;
      variantOptionValues: Awaited<ReturnType<StoreRepository["listActiveVariantOptionValues"]>>;
      media: ProductMediaRow[];
    },
  ): StoreProductDetail {
    const visibleById = new Map(loaded.visibleCategories.map((entry) => [entry.id, entry]));
    const categories = loaded.categoryIds.flatMap((id) => {
      const entry = visibleById.get(id);
      return entry === undefined
        ? []
        : [
            {
              id: entry.id,
              slug: entry.slug,
              name: requiredText(entry.name, locale, `Category "${entry.slug}" name`),
            },
          ];
    });
    const optionPosition = new Map(
      loaded.options.map((entry, index) => [entry.id, index] as const),
    );
    // ADR 0007: only values some sellable variant (active and priced; the caller filtered) uses are offered, so no choice leads to nothing to buy.
    const sellableValueIds = new Set(
      loaded.variantOptionValues.map((value) => value.optionValueId),
    );
    const options = loaded.options
      .map((entry) => ({
        id: entry.id,
        code: entry.code,
        name: requiredText(entry.name, locale, `Option "${entry.code}" name`),
        values: loaded.optionValues
          .filter((value) => value.optionId === entry.id && sellableValueIds.has(value.id))
          .map((value) => ({
            id: value.id,
            code: value.code,
            name: requiredText(value.label, locale, `Option value "${value.code}" label`),
          })),
      }))
      .filter((entry) => entry.values.length > 0);
    const offeredValueIds = new Set(
      options.flatMap((entry) => entry.values.map((value) => value.id)),
    );
    return {
      id: row.id,
      slug: row.slug,
      title: requiredText(row.title, locale, `Product "${row.slug}" title`),
      description: optionalText(row.description, locale),
      brand: toBrand(row, locale),
      publishedAt: publishedAtOf(row),
      categories,
      attributes: serializeAttributes(loaded.assignments, "product", row.attributes, locale),
      attributeDefinitions: serializeAttributeDefinitions(loaded.assignments, locale),
      options,
      price: loaded.summary.price,
      availability: loaded.summary.availability,
      variants: loaded.variants.map((entry) => ({
        id: entry.id,
        sku: entry.sku,
        optionValues: loaded.variantOptionValues
          .filter((value) => value.variantId === entry.id)
          .sort(
            (left, right) =>
              (optionPosition.get(left.optionId) ?? 0) - (optionPosition.get(right.optionId) ?? 0),
          )
          .map(({ optionCode, valueCode }) => ({ optionCode, valueCode })),
        attributes: serializeAttributes(loaded.assignments, "variant", entry.attributes, locale),
        ...pricingOf(loaded.pricedVariants, entry.id),
      })),
      media: loaded.media
        .filter((entry) => entry.optionValueId === null || offeredValueIds.has(entry.optionValueId))
        .map((entry) => ({
          url: entry.url,
          alt: optionalText(entry.alt, locale),
          optionValueId: entry.optionValueId,
        })),
    };
  }
}
