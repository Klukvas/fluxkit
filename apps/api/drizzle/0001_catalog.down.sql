-- Hand-written rollback for 0001_catalog (drizzle-kit does not generate down migrations).
-- Tables are dropped in exact reverse dependency order, without CASCADE: an unexpected dependent object must fail loudly.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "media";
DROP TABLE IF EXISTS "variant_option_value";
DROP TABLE IF EXISTS "variant";
DROP TABLE IF EXISTS "product_option_value";
DROP TABLE IF EXISTS "product_option";
DROP TABLE IF EXISTS "product_category";
DROP TABLE IF EXISTS "product";
DROP TABLE IF EXISTS "brand";
DROP TABLE IF EXISTS "category";
DROP TABLE IF EXISTS "product_type_option";
DROP TABLE IF EXISTS "product_type_attribute";
DROP TABLE IF EXISTS "product_type";
DROP TABLE IF EXISTS "option_value";
DROP TABLE IF EXISTS "option";
DROP TABLE IF EXISTS "attribute_option";
DROP TABLE IF EXISTS "attribute";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1792023871912;
