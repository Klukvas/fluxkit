-- Only the operator rewrap transaction may replace envelope columns. Identity remains immutable.
CREATE OR REPLACE FUNCTION integration_merchant_baseline_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'integration_merchant_baseline_immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['created_by', 'key_id', 'nonce', 'ciphertext', 'tag'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['created_by', 'key_id', 'nonce', 'ciphertext', 'tag'])
      OR (ROW(NEW.key_id, NEW.nonce, NEW.ciphertext, NEW.tag) IS DISTINCT FROM
          ROW(OLD.key_id, OLD.nonce, OLD.ciphertext, OLD.tag)
        AND current_setting('fluxkit.baseline_rewrap', true) IS DISTINCT FROM 'on')
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
