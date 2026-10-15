import { Inject, Injectable } from "@nestjs/common";
import { type StoreLocale } from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../common/locale.js";
import { toPage, type Page } from "../../common/pagination.js";
import { notFound, validationFailed } from "../../common/problem.js";
import {
  flattenCategories,
  subtreeIds,
  visibleCategoryTree,
  type VisibleCategory,
} from "./store-categories.js";
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
} from "./store.repository.js";
import type {
  StoreCategoryNode,
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

/** The list image: the first gallery image (no option pair), else the first image of any kind. */
function pickListImage(media: readonly ProductMediaRow[], locale: StoreLocale) {
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
  ) {}

  /** `?locale=` must be configured; missing means the default locale. Fallback to the default is per field. */
  private resolveLocale(requested: string | undefined): StoreLocale {
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
      { categoryIds, brandSlug: query.brand },
      query,
    );
    const media = await this.store.listMediaForProducts(rows.map((row) => row.id));
    const items = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: requiredText(row.title, locale, `Product "${row.slug}" title`),
      brand: toBrand(row, locale),
      image: pickListImage(
        media.filter((entry) => entry.productId === row.id),
        locale,
      ),
      publishedAt: publishedAtOf(row),
    }));
    return toPage(items, total, query);
  }

  async getProduct(slug: string, requestedLocale: string | undefined): Promise<StoreProductDetail> {
    const locale = this.resolveLocale(requestedLocale);
    if (!isStoreSlug(slug)) {
      // Not a possible slug (and NUL would be rejected by Postgres as a 500): no such product, no query.
      throw notFound("Product");
    }
    const row = await this.store.findActiveProductBySlug(slug);
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
    ] = await Promise.all([
      this.store.listTypeAttributes(row.productTypeId),
      this.store.listActiveCategories(),
      this.store.listCategoryIds(row.id),
      this.store.listProductOptions(row.id),
      this.store.listProductOptionValues(row.id),
      this.store.listActiveVariants(row.id),
      this.store.listActiveVariantOptionValues(row.id),
      this.store.listMediaForProducts([row.id]),
    ]);
    return this.toDetail(row, locale, {
      assignments,
      visibleCategories: flattenCategories(visibleCategoryTree(activeCategories)),
      categoryIds,
      options,
      optionValues,
      variants,
      variantOptionValues,
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
      variants: Awaited<ReturnType<StoreRepository["listActiveVariants"]>>;
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
    // ADR 0007: only values some ACTIVE variant uses are offered, so no choice leads to nothing to buy.
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
