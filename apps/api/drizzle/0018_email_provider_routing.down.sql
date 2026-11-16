-- Stop all mail senders before rollback. Never discard a deferred safe next-provider selection.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "email_message"
    WHERE "status" IN ('pending', 'sending') AND "route_provider_code" IS NOT NULL) THEN
    RAISE EXCEPTION 'email_provider_routing_rollback_incompatible';
  END IF;
END $$;
DROP TABLE "email_provider_state";
DROP INDEX "email_message_provider_sent_at_idx";
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_route_provider_code_check";
ALTER TABLE "email_message" DROP COLUMN "route_provider_code";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794837706505;
COMMIT;
