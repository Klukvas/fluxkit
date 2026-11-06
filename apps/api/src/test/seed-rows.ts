import type pg from "pg";
import { testCatalogSeed, type CatalogSeed, type SeedCategory } from "@fluxkit/seeds";

/** The category tree level by level, deepest first (children are deleted before their parents). */
function levelsDeepestFirst(roots: readonly SeedCategory[]): SeedCategory[][] {
  const levels: SeedCategory[][] = [];
  let level: readonly SeedCategory[] = roots;
  while (level.length > 0) {
    levels.unshift([...level]);
    level = level.flatMap((node) => node.children ?? []);
  }
  return levels;
}

/**
 * TEST ONLY: removes what a seed dataset creates (default: the test fixture), found by its stable codes and slugs, children
 * before parents (the specs that run the seed on the shared test database leave it as they found it).
 */
export async function removeSeedRows(
  pool: pg.Pool,
  catalogSeed: CatalogSeed = testCatalogSeed,
): Promise<void> {
  const { attributes, options, productTypes, brands, categories, products, shippingMethods } =
    catalogSeed;
  const demoSynonymTerms = catalogSeed.synonymGroups.flatMap((group) => [...group.terms]);
  const productSlugs = products.map((product) => product.slug);
  // The demo home banners (fixed ids), then the seed's own uploads they used (their `banner_image` rows go by cascade).
  const bannerIds = catalogSeed.banners.map((item) => item.id);
  const bannerUploads = await pool.query<{ id: string }>(
    `select image_upload_id as id from banner where id = any($1::uuid[])
     union select image_upload_id from banner_image where banner_id = any($1::uuid[])`,
    [bannerIds],
  );
  await pool.query("delete from banner where id = any($1::uuid[])", [bannerIds]);
  await pool.query("delete from media_upload where created_by is null and id = any($1::uuid[])", [
    bannerUploads.rows.map((row) => row.id),
  ]);
  const where = "product_id in (select id from product where slug = any($1))";
  // The seed's own uploads (no admin) that the demo products name; the files stay in the spec's temp media directory.
  await pool.query(
    `delete from media_upload where created_by is null and storage_key in
       (select substring(url from '[0-9a-f]{32}\\.(?:jpg|png|webp)$') from media where ${where})`,
    [productSlugs],
  );
  await pool.query(`delete from media where ${where}`, [productSlugs]);
  await pool.query(`delete from variant where ${where}`, [productSlugs]);
  await pool.query("delete from product where slug = any($1)", [productSlugs]);
  for (const level of levelsDeepestFirst(categories)) {
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
