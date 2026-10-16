import type pg from "pg";

/** The shop currency of `startApp` unless a spec passes another one (the default of `SHOP_CURRENCY`). */
export const TEST_SHOP_CURRENCY = "UAH";

/**
 * Gives every variant of a product (that has none yet) a shop-currency price, so the product can be published.
 * Prices are written straight into the table on purpose: specs of other features need a priced product, and must not
 * depend on the price endpoints (those have their own spec). Variants created later are not priced; call it again.
 */
export async function priceProductVariants(
  pool: pg.Pool,
  productId: string,
  amount = 1_000,
  currency: string = TEST_SHOP_CURRENCY,
): Promise<void> {
  await pool.query(
    `insert into price (variant_id, currency, amount)
     select id, $2, $3 from variant where product_id = $1
     on conflict (variant_id, currency) do nothing`,
    [productId, currency, amount],
  );
}
