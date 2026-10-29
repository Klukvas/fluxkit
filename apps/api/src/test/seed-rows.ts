import type pg from "pg";
import { catalogSeed, type SeedCategory } from "@fluxkit/seeds";

/**
 * TEST ONLY: removes what the demo seed creates, found by its stable codes and slugs, children before parents (the specs
 * that run the seed on the shared test database leave it as they found it).
 */
export async function removeSeedRows(pool: pg.Pool): Promise<void> {
  const { attributes, options, productTypes, brands, categories, products, shippingMethods } =
    catalogSeed;
  const demoSynonymTerms = catalogSeed.synonymGroups.flatMap((group) => [...group.terms]);
  const productSlugs = products.map((product) => product.slug);
  const where = "product_id in (select id from product where slug = any($1))";
  await pool.query(`delete from media where ${where}`, [productSlugs]);
  await pool.query(`delete from variant where ${where}`, [productSlugs]);
  await pool.query("delete from product where slug = any($1)", [productSlugs]);
  const levels: (readonly SeedCategory[])[] = [
    categories.flatMap((root) => root.children ?? []),
    categories,
  ];
  for (const level of levels) {
    await pool.query("delete from category where slug = any($1)", [level.map((node) => node.slug)]);
  }
  await pool.query("delete from brand where slug = any($1)", [brands.map((b) => b.slug)]);
  await pool.query("delete from product_type where code = any($1)", [
    productTypes.map((type) => type.code),
  ]);
  await pool.query("delete from attribute where code = any($1)", [
    attributes.map((attribute) => attribute.code),
  ]);
  await pool.query('delete from "option" where code = any($1)', [
    options.map((option) => option.code),
  ]);
  await pool.query("delete from shipping_method where code = any($1)", [
    shippingMethods.map((method) => method.code),
  ]);
  await pool.query("delete from search_synonym_group where terms && $1::text[]", [
    demoSynonymTerms,
  ]);
}
