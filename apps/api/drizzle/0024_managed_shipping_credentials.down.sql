-- Stop shipping/integration writers before rollback. Never clear bindings to make this pass.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE integration IN ACCESS EXCLUSIVE MODE;
LOCK TABLE integration_credential_version IN ACCESS EXCLUSIVE MODE;
LOCK TABLE shipment IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM shipment WHERE integration_credential_version_id IS NOT NULL) THEN
    RAISE EXCEPTION 'managed_shipping_credentials_rollback_incompatible';
  END IF;
END;
$$;
DROP TRIGGER integration_managed_shipping_identity_guard ON integration;
DROP FUNCTION integration_managed_shipping_identity_guard();
DROP TRIGGER shipment_credential_binding_guard ON shipment;
DROP FUNCTION shipment_credential_binding_guard();
ALTER TABLE shipment DROP CONSTRAINT shipment_integration_credential_version_id_fkey;
DROP INDEX shipment_integration_credential_version_id_idx;
ALTER TABLE shipment DROP COLUMN integration_credential_version_id;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795800130582;
COMMIT;
