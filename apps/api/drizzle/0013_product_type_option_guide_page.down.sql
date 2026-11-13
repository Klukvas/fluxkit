-- Hand-written rollback for 0013_product_type_option_guide_page (drizzle-kit does not generate down migrations).
-- Drops the option guide page of product types (plan docs/plans/2026-11-13-product-type-guide-page.md) with its CHECK; the
-- slugs set on product types are lost, and the storefront then links no guide page unless its fallback is set.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
ALTER TABLE "product_type" DROP CONSTRAINT IF EXISTS "product_type_option_guide_page_check";
ALTER TABLE "product_type" DROP COLUMN IF EXISTS "option_guide_page";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794568929098;
