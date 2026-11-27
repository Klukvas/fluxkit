-- Stop payment/integration writers first. Permanent enrollment is never deleted to enable rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE integration IN ACCESS EXCLUSIVE MODE;
LOCK TABLE integration_credential_version IN ACCESS EXCLUSIVE MODE;
LOCK TABLE payment IN ACCESS EXCLUSIVE MODE;
LOCK TABLE integration_merchant_baseline IN ACCESS EXCLUSIVE MODE;
LOCK TABLE admin_audit_event IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payment WHERE integration_credential_version_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM integration_merchant_baseline)
    OR EXISTS (SELECT 1 FROM admin_audit_event a JOIN integration i ON i.id = a.target_id
      WHERE a.target_kind = 'integration' AND i.kind = 'payment'
        AND a.action IN ('integration.activated', 'integration.disabled', 'integration.revoked')) THEN
    RAISE EXCEPTION 'managed_payment_credentials_rollback_incompatible';
  END IF;
END;
$$;
DROP TRIGGER integration_managed_payment_identity_guard ON integration;
DROP FUNCTION integration_managed_payment_identity_guard();
DROP TRIGGER payment_credential_binding_guard ON payment;
DROP FUNCTION payment_credential_binding_guard();
ALTER TABLE payment DROP CONSTRAINT payment_integration_credential_version_id_fkey;
DROP INDEX payment_integration_credential_version_id_idx;
ALTER TABLE payment DROP COLUMN integration_credential_version_id;
DROP TABLE integration_merchant_baseline;
DROP FUNCTION integration_merchant_baseline_guard();
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795794376041;
COMMIT;
