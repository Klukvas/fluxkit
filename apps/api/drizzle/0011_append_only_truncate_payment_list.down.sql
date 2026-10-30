-- Hand-written rollback for 0011_append_only_truncate_payment_list (drizzle-kit does not generate down migrations).
-- Drops the BEFORE TRUNCATE triggers of the append-only tables and their function, then the two payment list indexes.
-- No row is touched. The audit action admin_user.activated of the same release changed no CHECK
-- (admin_audit_event_action_check of 0009 is a code pattern), so there is no CHECK value to remove: rows of that action
-- stay valid and stay (the audit table is append-only); the previous code lists them as an unknown action.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TRIGGER IF EXISTS "stock_movement_no_truncate" ON "stock_movement";
DROP TRIGGER IF EXISTS "shipment_status_change_no_truncate" ON "shipment_status_change";
DROP TRIGGER IF EXISTS "payment_event_no_truncate" ON "payment_event";
DROP TRIGGER IF EXISTS "order_status_change_no_truncate" ON "order_status_change";
DROP TRIGGER IF EXISTS "order_shipping_no_truncate" ON "order_shipping";
DROP TRIGGER IF EXISTS "order_item_no_truncate" ON "order_item";
DROP TRIGGER IF EXISTS "order_adjustment_no_truncate" ON "order_adjustment";
DROP TRIGGER IF EXISTS "admin_audit_event_no_truncate" ON "admin_audit_event";
DROP FUNCTION IF EXISTS "append_only_refuse_truncate"();
DROP INDEX IF EXISTS "payment_created_at_id_idx";
DROP INDEX IF EXISTS "payment_attention_created_at_id_idx";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793377241819;
