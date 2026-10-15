import { and, eq, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../common/transaction.js";
import { product, productTypeAttribute, variant } from "../../database/schema/index.js";

/**
 * "Is this attribute in use" facts for the core change rules (ADR 0006 section 5). Values live in the JSONB
 * `attributes` column of products and variants, keyed by attribute code, and only for products whose type assigns
 * the attribute. `productTypeId` narrows the question to the products of one type.
 */

interface Scope {
  readonly attributeId: string;
  readonly productTypeId: string | undefined;
}

type HasValue = (attributes: SQL) => SQL;

async function productHasValue(db: DbExecutor, scope: Scope, hasValue: HasValue): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(product)
    .innerJoin(productTypeAttribute, eq(productTypeAttribute.productTypeId, product.productTypeId))
    .where(
      and(
        eq(productTypeAttribute.attributeId, scope.attributeId),
        scope.productTypeId === undefined
          ? undefined
          : eq(product.productTypeId, scope.productTypeId),
        hasValue(sql`${product.attributes}`),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function variantHasValue(db: DbExecutor, scope: Scope, hasValue: HasValue): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(variant)
    .innerJoin(product, eq(product.id, variant.productId))
    .innerJoin(productTypeAttribute, eq(productTypeAttribute.productTypeId, product.productTypeId))
    .where(
      and(
        eq(productTypeAttribute.attributeId, scope.attributeId),
        scope.productTypeId === undefined
          ? undefined
          : eq(product.productTypeId, scope.productTypeId),
        hasValue(sql`${variant.attributes}`),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function anyHasValue(db: DbExecutor, scope: Scope, hasValue: HasValue): Promise<boolean> {
  return (
    (await productHasValue(db, scope, hasValue)) || (await variantHasValue(db, scope, hasValue))
  );
}

/** True when any product or variant stores a value for the attribute (optionally only products of one type). */
export function attributeHasValues(
  db: DbExecutor,
  attribute: { id: string; code: string },
  productTypeId?: string,
): Promise<boolean> {
  return anyHasValue(
    db,
    { attributeId: attribute.id, productTypeId },
    (attributes) => sql`${attributes} ? ${attribute.code}::text`,
  );
}

/** True when a `select` value equals the option code, or a `multiselect` array contains it. */
export function attributeOptionCodeInUse(
  db: DbExecutor,
  attribute: { id: string; code: string },
  optionCode: string,
): Promise<boolean> {
  return anyHasValue(
    db,
    { attributeId: attribute.id, productTypeId: undefined },
    (attributes) => sql`(${attributes} -> ${attribute.code}::text) ? ${optionCode}::text`,
  );
}
