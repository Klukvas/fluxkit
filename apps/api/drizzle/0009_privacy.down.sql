-- Hand-written rollback for 0009_privacy (drizzle-kit does not generate down migrations).
-- It REFUSES to run while any order has an erased contact: the erased email, phone and names cannot be restored, and
-- making the columns NOT NULL again would need invented values (ADR 0033 decision 5: an explicit error, never a silent fill).
-- The whole script runs as one multi-statement query, so a refusal or any later failure changes nothing.
-- Tables are dropped without CASCADE: an unexpected dependent object must fail loudly. Dropping a table also drops its
-- constraints, indexes and trigger; the trigger function is dropped afterwards.
-- This deletes every privacy request and audit event. Orders keep everything else.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "sales_order" WHERE "contact_erased_at" IS NOT NULL) THEN
		RAISE EXCEPTION '0009_privacy cannot be rolled back: some orders have an erased contact that cannot be restored'
			USING ERRCODE = 'restrict_violation';
	END IF;
END;
$$;
DROP TABLE IF EXISTS "admin_audit_event";
DROP TABLE IF EXISTS "privacy_request";
DROP FUNCTION IF EXISTS "admin_audit_event_append_only"();
ALTER TABLE "sales_order" DROP CONSTRAINT IF EXISTS "sales_order_erased_access_check";
ALTER TABLE "sales_order" DROP CONSTRAINT IF EXISTS "sales_order_contact_check";
ALTER TABLE "sales_order" DROP COLUMN IF EXISTS "contact_erased_at";
ALTER TABLE "sales_order" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "sales_order" ALTER COLUMN "phone" SET NOT NULL;
ALTER TABLE "sales_order" ALTER COLUMN "first_name" SET NOT NULL;
ALTER TABLE "sales_order" ALTER COLUMN "last_name" SET NOT NULL;
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793255597426;
