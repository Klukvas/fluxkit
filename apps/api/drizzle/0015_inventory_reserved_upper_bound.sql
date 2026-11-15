-- Hand-written preflight: refuse invalid existing data before replacing the generated CHECK.
-- Keep writers out until the migrator commits, so the preflight and the new constraint see the same rows.
DO $$
BEGIN
  LOCK TABLE "inventory_level" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM "inventory_level" WHERE "reserved" > 1000000000) THEN
    RAISE EXCEPTION 'Cannot apply 0015_inventory_reserved_upper_bound: inventory_level.reserved exceeds 1000000000; reconcile inventory before retrying.';
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "inventory_level" DROP CONSTRAINT "inventory_level_reserved_check";--> statement-breakpoint
ALTER TABLE "inventory_level" ADD CONSTRAINT "inventory_level_reserved_check" CHECK ("inventory_level"."reserved" >= 0 AND "inventory_level"."reserved" <= 1000000000);
