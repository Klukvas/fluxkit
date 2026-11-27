BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE integration_credential_version IN ACCESS EXCLUSIVE MODE;
LOCK TABLE integration_secret IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM integration_credential_version WHERE environment <> 'default')
    OR EXISTS (SELECT 1 FROM integration_secret GROUP BY version_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'integration_environment_rollback_incompatible';
  END IF;
END;
$$;
DROP TRIGGER integration_credential_identity_and_state_guard ON integration_credential_version;
DROP FUNCTION integration_credential_identity_and_state();
ALTER TABLE integration_credential_version DROP CONSTRAINT integration_credential_version_environment_check;
ALTER TABLE integration_credential_version DROP COLUMN environment;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795789606187;
COMMIT;
