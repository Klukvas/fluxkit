import { and, eq, exists, not, or, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../common/transaction.js";
import {
  option,
  optionValue,
  product,
  variant,
  variantOptionValue,
} from "../../database/schema/index.js";

/** Existence matches resolveTextWithFallback: requested, default, then any usable locale.
 * Trim the same whitespace as String.trim(), including non-ASCII spaces.
 */
function hasUsableText(text: SQL): SQL {
  const whitespace =
    "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  return sql`exists (select 1 from jsonb_each(${text}) as translation
    where jsonb_typeof(translation.value) = 'string'
      and btrim(translation.value #>> '{}', ${whitespace}) <> '')`;
}

/** Any active variant's referenced choices must have usable text, even if that variant is not priced. */
function hasUnusableVariantOption(db: DbExecutor): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(variantOptionValue)
      .innerJoin(variant, eq(variant.id, variantOptionValue.variantId))
      .innerJoin(option, eq(option.id, variantOptionValue.optionId))
      .innerJoin(optionValue, eq(optionValue.id, variantOptionValue.optionValueId))
      .where(
        and(
          eq(variant.productId, product.id),
          eq(variant.isActive, true),
          or(
            not(hasUsableText(sql`${option.name}`)),
            not(hasUsableText(sql`${optionValue.label}`)),
          ),
        ),
      ),
  );
}

/** Shared by store pagination/hydration and search indexing; any locale may supply required text. */
export function hasUsableProductText(db: DbExecutor): SQL {
  return and(hasUsableText(sql`${product.title}`), not(hasUnusableVariantOption(db))) as SQL;
}
