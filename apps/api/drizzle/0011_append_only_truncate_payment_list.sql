CREATE INDEX "payment_attention_created_at_id_idx" ON "payment" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "payment"."needs_attention";--> statement-breakpoint
CREATE INDEX "payment_created_at_id_idx" ON "payment" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
-- Hand-written (drizzle-kit does not model triggers). The append-only and immutable tables of migrations 0003, 0004,
-- 0006, 0008 and 0009 (ADR 0012, 0019, 0033) are guarded by ROW triggers, which TRUNCATE does not fire. A statement-level
-- BEFORE TRUNCATE trigger refuses it, also when the table is reached through TRUNCATE ... CASCADE. Like the row triggers,
-- it does not stop a superuser, the table owner (ALTER TABLE ... DISABLE TRIGGER, DROP TABLE) or
-- session_replication_role = replica (superuser only): the application role should be none of these
-- (docs/deployment.md, "Database roles").
-- The new audit action admin_user.activated (packages/core) needs no schema change: admin_audit_event_action_check of
-- 0009 is a code pattern, not a list.
CREATE FUNCTION "append_only_refuse_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION '% is append-only: TRUNCATE is not allowed', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "admin_audit_event_no_truncate" BEFORE TRUNCATE ON "admin_audit_event" FOR EACH STATEMENT EXECUTE FUNCTION "append_only_refuse_truncate"();--> statement-breakpoint
CREATE TRIGGER "order_adjustment_no_truncate" BEFORE TRUNCATE ON "order_adjustment" FOR EACH STATEMENT EXECUTE FUNCTION "append_only_refuse_truncate"();--> statement-breakpoint
CREATE TRIGGER "order_item_no_truncate" BEFORE TRUNCATE ON "order_item" FOR EACH STATEMENT EXECUTE FUNCTION "append_only_refuse_truncate"();--> statement-breakpoint
CREATE TRIGGER "order_shipping_no_truncate" BEFORE TRUNCATE ON "order_shipping" FOR EACH STATEMENT EXECUTE FUNCTION "append_only_refuse_truncate"();--> statement-breakpoint
CREATE TRIGGER "order_status_change_no_truncate" BEFORE TRUNCATE ON "order_status_change" FOR EACH STATEMENT EXECUTE FUNCTION "append_only_refuse_truncate"();--> statement-breakpoint
CREATE TRIGGER "payment_event_no_truncate" BEFORE TRUNCATE ON "payment_event" FOR EACH STATEMENT EXECUTE FUNCTION "append_only_refuse_truncate"();--> statement-breakpoint
CREATE TRIGGER "shipment_status_change_no_truncate" BEFORE TRUNCATE ON "shipment_status_change" FOR EACH STATEMENT EXECUTE FUNCTION "append_only_refuse_truncate"();--> statement-breakpoint
CREATE TRIGGER "stock_movement_no_truncate" BEFORE TRUNCATE ON "stock_movement" FOR EACH STATEMENT EXECUTE FUNCTION "append_only_refuse_truncate"();
