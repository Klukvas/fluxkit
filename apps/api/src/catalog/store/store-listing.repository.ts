import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../../database/database.module.js";
import {
  brand,
  option,
  optionValue,
  price,
  product,
  productOption,
  productTypeOption,
  variant,
  variantOptionValue,
} from "../../database/schema/index.js";

/** Enumerate the SAME eligible groups for page and count, before applying pagination. */
export async function listProductGroups(
  db: Database,
  where: SQL | undefined,
  currency: string,
  page: { limit: number; offset: number },
) {
  const key = sql<string>`case when ${productOption.optionId} is null then ${product.id}::text
    else ${product.id}::text || ':' || ${option.code} || ':' || ${optionValue.code} end`;
  const groups = db
    .selectDistinct({
      id: product.id,
      slug: product.slug,
      title: product.title,
      publishedAt: product.publishedAt,
      brandSlug: sql<string | null>`${brand.slug}`.as("brand_slug"),
      brandName: brand.name,
      listingKey: key.as("listing_key"),
    })
    .from(product)
    .leftJoin(brand, eq(brand.id, product.brandId))
    .innerJoin(variant, and(eq(variant.productId, product.id), eq(variant.isActive, true)))
    .innerJoin(price, and(eq(price.variantId, variant.id), eq(price.currency, currency)))
    .leftJoin(
      productTypeOption,
      and(
        eq(productTypeOption.productTypeId, product.productTypeId),
        eq(productTypeOption.splitsListing, true),
      ),
    )
    .leftJoin(
      productOption,
      and(
        eq(productOption.productId, product.id),
        eq(productOption.optionId, productTypeOption.optionId),
      ),
    )
    .leftJoin(option, eq(option.id, productOption.optionId))
    .leftJoin(
      variantOptionValue,
      and(
        eq(variantOptionValue.variantId, variant.id),
        eq(variantOptionValue.optionId, productOption.optionId),
      ),
    )
    .leftJoin(optionValue, eq(optionValue.id, variantOptionValue.optionValueId))
    .where(where)
    .as("listing_groups");
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(groups)
      .orderBy(
        sql`${groups.publishedAt} desc nulls last`,
        sql`${groups.id} desc`,
        sql`${groups.listingKey} collate "C" asc`,
      )
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(groups),
  ]);
  return { rows, total: counts[0]?.total ?? 0 };
}

/** Current chosen options, split assignments and variant pairs in one batched read, independent of search caches. */
export function readListingFacts(db: Database, productIds: readonly string[]) {
  return db
    .select({
      productId: product.id,
      optionCode: option.code,
      optionName: option.name,
      splitsListing: productTypeOption.splitsListing,
      variantId: variantOptionValue.variantId,
      valueCode: optionValue.code,
      valueId: optionValue.id,
      valueName: optionValue.label,
    })
    .from(product)
    .innerJoin(productOption, eq(productOption.productId, product.id))
    .innerJoin(option, eq(option.id, productOption.optionId))
    .leftJoin(
      productTypeOption,
      and(
        eq(productTypeOption.productTypeId, product.productTypeId),
        eq(productTypeOption.optionId, option.id),
      ),
    )
    .leftJoin(
      variantOptionValue,
      and(eq(variantOptionValue.productId, product.id), eq(variantOptionValue.optionId, option.id)),
    )
    .leftJoin(optionValue, eq(optionValue.id, variantOptionValue.optionValueId))
    .where(inArray(product.id, [...productIds]))
    .orderBy(asc(product.id), asc(option.code));
}
export type ListingFact = Awaited<ReturnType<typeof readListingFacts>>[number];
export interface ListingReference {
  readonly productId: string;
  readonly listingKey: string;
}
