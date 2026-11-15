import type { CatalogSeed } from "@fluxkit/seeds";
import type pg from "pg";
import { expect } from "vitest";

/** Shared real-database checks for both datasets; keep product-mode list assertions in their own specs unchanged. */
export async function expectSeedSplitOptions(pool: pg.Pool, seed: CatalogSeed): Promise<void> {
  const result = await pool.query<{ type: string; option: string; splits: boolean }>(
    `select pt.code as type, o.code as option, pto.splits_listing as splits
     from product_type_option pto join product_type pt on pt.id = pto.product_type_id
     join option o on o.id = pto.option_id where pt.code = any($1) order by pt.code, o.code`,
    [seed.productTypes.map((type) => type.code)],
  );
  const expected = seed.productTypes.flatMap((type) =>
    type.optionCodes.map((option) => ({
      type: type.code,
      option,
      splits: option === type.splitListingOptionCode,
    })),
  );
  expect(result.rows).toEqual(
    [...expected].sort((a, b) => a.type.localeCompare(b.type) || a.option.localeCompare(b.option)),
  );
}

/** Simulate saved editor choices (all disabled or another axis enabled); reseeding must preserve both. */
export async function expectSeedSplitFlagsPreserved(
  pool: pg.Pool,
  seed: CatalogSeed,
  runSeed: () => Promise<unknown>,
): Promise<void> {
  const type = seed.productTypes.find((type) => type.splitListingOptionCode !== undefined);
  if (type === undefined) throw new Error("Expected a split demo type");
  const other = type.optionCodes.find((code) => code !== type.splitListingOptionCode);
  if (other === undefined) throw new Error("Expected an ordinary option on the split demo type");
  const setSplit = async (option: string | null) => {
    await pool.query(
      `update product_type_option set splits_listing = false
      where product_type_id = (select id from product_type where code = $1)`,
      [type.code],
    );
    await pool.query(
      `update product_type_option set splits_listing = true
      where product_type_id = (select id from product_type where code = $1)
      and option_id = (select id from option where code = $2)`,
      [type.code, option],
    );
  };
  try {
    for (const option of [null, other]) {
      await setSplit(option);
      await runSeed();
      const result = await pool.query<{ code: string; splits: boolean }>(
        `select o.code, pto.splits_listing as splits from product_type_option pto
       join product_type pt on pt.id = pto.product_type_id join option o on o.id = pto.option_id
       where pt.code = $1 order by o.code`,
        [type.code],
      );
      expect(result.rows).toEqual(
        [...type.optionCodes].sort().map((code) => ({ code, splits: code === option })),
      );
    }
  } finally {
    await setSplit(type.splitListingOptionCode ?? null);
  }
}
