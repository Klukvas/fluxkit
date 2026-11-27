BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE integration_merchant_baseline IN ACCESS EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION integration_merchant_baseline_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'integration_merchant_baseline_immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'created_by') IS DISTINCT FROM (to_jsonb(OLD) - 'created_by')
      OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT (
        pg_trigger_depth() > 1 AND OLD.created_by IS NOT NULL AND NEW.created_by IS NULL
      )) THEN
      RAISE EXCEPTION 'integration_merchant_baseline_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM integration WHERE id = NEW.integration_id AND kind = NEW.kind
    AND provider_code = NEW.provider_code FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'integration_merchant_baseline_identity_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795808000000;
COMMIT;
