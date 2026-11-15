import { randomUUID } from "node:crypto";
import type pg from "pg";

/** Isolated split and unsplit types sharing one option; never changes the seed fixture's flags. */
export async function createListingFixture(pool: pg.Pool) {
  const tag = randomUUID().slice(0, 8);
  const splitType = randomUUID();
  const plainType = randomUUID();
  const colorId = randomUUID();
  const sizeId = randomUUID();
  const brandId = randomUUID();
  const categoryId = randomUUID();
  const colorCode = `color_${tag}`;
  const sizeCode = `size_${tag}`;
  const brandSlug = `listing-${tag}`;
  const title = `Сорочка listingprobe${tag}`;
  const splitProduct = randomUUID();
  const plainProduct = randomUUID();
  const noAxisProduct = randomUUID();
  const redId = randomUUID();
  const blueId = randomUUID();
  const smallId = randomUUID();
  const mediumId = randomUUID();
  await pool.query(
    `insert into product_type (id, code, name) values
    ($1, $3, '{"uk":"Split"}'), ($2, $4, '{"uk":"Plain"}')`,
    [splitType, plainType, `split_${tag}`, `plain_${tag}`],
  );
  await pool.query(
    `insert into option (id, code, name) values
    ($1, $3, '{"uk":"Колір","en":"Color"}'), ($2, $4, '{"uk":"Розмір"}')`,
    [colorId, sizeId, colorCode, sizeCode],
  );
  await pool.query(
    `insert into option_value (id, option_id, code, label) values
    ($1, $5, 'red', '{"uk":"Червоний","en":"Red"}'),
    ($2, $5, 'blue', '{"uk":"Синій"}'),
    ($3, $6, 's', '{"uk":"S"}'), ($4, $6, 'm', '{"uk":"M"}')`,
    [redId, blueId, smallId, mediumId, colorId, sizeId],
  );
  await pool.query(
    `insert into product_type_option (product_type_id, option_id, splits_listing) values
    ($1, $3, true), ($1, $4, false), ($2, $3, false), ($2, $4, false)`,
    [splitType, plainType, colorId, sizeId],
  );
  await pool.query(`insert into brand (id, slug, name) values ($1, $2, '{"uk":"Listing brand"}')`, [
    brandId,
    brandSlug,
  ]);
  await pool.query(
    `insert into category (id, slug, name) values ($1, $2, '{"uk":"Listing category"}')`,
    [categoryId, brandSlug],
  );
  const variants: { id: string; productId: string; color: string; size: string; amount: number }[] =
    [];
  for (const [productId, typeId, suffix] of [
    [splitProduct, splitType, "split"],
    [plainProduct, plainType, "plain"],
    [noAxisProduct, splitType, "noaxis"],
  ] as const) {
    await pool.query(
      `insert into product (id, product_type_id, brand_id, slug, title, status, published_at)
      values ($1, $2, $3, $4, $5, 'active', '2026-11-14T12:00:00Z')`,
      [productId, typeId, brandId, `${suffix}-${tag}`, { uk: title }],
    );
    await pool.query(`insert into product_category (product_id, category_id) values ($1, $2)`, [
      productId,
      categoryId,
    ]);
    if (productId !== noAxisProduct) {
      for (const [optionId, values] of [
        [colorId, [redId, blueId]],
        [sizeId, [smallId, mediumId]],
      ] as const) {
        await pool.query(`insert into product_option (product_id, option_id) values ($1, $2)`, [
          productId,
          optionId,
        ]);
        for (const valueId of values)
          await pool.query(
            `insert into product_option_value (product_id, option_id, option_value_id) values ($1, $2, $3)`,
            [productId, optionId, valueId],
          );
      }
    }
    const combinations =
      productId === noAxisProduct
        ? ([["", "", 500]] as const)
        : ([
            ["red", "s", 0],
            ["red", "m", 1200],
            ["blue", "s", 3000],
            ["blue", "m", 4500],
          ] as const);
    for (const [color, size, amount] of combinations) {
      const id = randomUUID();
      const signature = color === "" ? "" : `${colorCode}=${color};${sizeCode}=${size}`;
      await pool.query(
        `insert into variant (id, product_id, sku, option_signature, is_default, track_inventory)
        values ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          productId,
          `${tag}-${suffix}-${color || "default"}-${size || "default"}`.toUpperCase(),
          signature,
          size !== "m" && color !== "blue",
          color === "blue",
        ],
      );
      await pool.query(
        `insert into price (variant_id, currency, amount) values ($1, 'UAH', $2), ($1, 'USD', 999999)`,
        [id, amount],
      );
      if (color !== "") {
        for (const [optionId, valueId] of [
          [colorId, color === "red" ? redId : blueId],
          [sizeId, size === "s" ? smallId : mediumId],
        ]) {
          await pool.query(
            `insert into variant_option_value (variant_id, product_id, option_id, option_value_id) values ($1, $2, $3, $4)`,
            [id, productId, optionId, valueId],
          );
        }
      }
      variants.push({ id, productId, color, size, amount });
    }
  }
  await pool.query(
    `insert into media (product_id, option_id, option_value_id, url, position) values
    ($1, $2, $3, 'https://img.test/red.jpg', 0),
    ($1, null, null, 'https://img.test/general.jpg', 1)`,
    [splitProduct, colorId, redId],
  );
  return {
    splitType,
    plainType,
    splitProduct,
    plainProduct,
    noAxisProduct,
    colorId,
    colorCode,
    sizeCode,
    brandId,
    brandSlug,
    categoryId,
    title,
    variants,
    async cleanup() {
      await pool.query("delete from product where product_type_id = any($1::uuid[])", [
        [splitType, plainType],
      ]);
      await pool.query("delete from product_type where id = any($1::uuid[])", [
        [splitType, plainType],
      ]);
      await pool.query("delete from option where id = any($1::uuid[])", [[colorId, sizeId]]);
      await pool.query("delete from brand where id = $1", [brandId]);
      await pool.query("delete from category where id = $1", [categoryId]);
    },
  };
}
export type ListingFixture = Awaited<ReturnType<typeof createListingFixture>>;
