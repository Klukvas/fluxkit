ALTER TABLE "shipment" ADD COLUMN "integration_credential_version_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_integration_credential_version_id_fkey" FOREIGN KEY ("integration_credential_version_id") REFERENCES "public"."integration_credential_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipment_integration_credential_version_id_idx" ON "shipment" USING btree ("integration_credential_version_id");
--> statement-breakpoint
-- Lock the integration before its version, matching runtime admission and lifecycle writers.
CREATE OR REPLACE FUNCTION shipment_credential_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.integration_credential_version_id IS NOT NULL
    AND NEW.integration_credential_version_id IS DISTINCT FROM OLD.integration_credential_version_id THEN
    RAISE EXCEPTION 'shipment_credential_binding_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.integration_credential_version_id IS NOT NULL THEN
    SELECT integration_id INTO owner_id FROM integration_credential_version
      WHERE id = NEW.integration_credential_version_id;
    PERFORM 1 FROM integration WHERE id = owner_id AND kind = 'shipping'
      AND provider_code = NEW.provider_code FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'shipment_credential_version_mismatch' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM integration_credential_version WHERE id = NEW.integration_credential_version_id
      AND integration_id = owner_id AND purpose = 'outbound' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'shipment_credential_version_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipment_credential_binding_guard BEFORE INSERT OR UPDATE ON shipment
FOR EACH ROW EXECUTE FUNCTION shipment_credential_binding_guard();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION integration_managed_shipping_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.provider_code IS DISTINCT FROM OLD.provider_code THEN
    IF EXISTS (SELECT 1 FROM shipment s JOIN integration_credential_version v
      ON v.id = s.integration_credential_version_id WHERE v.integration_id = OLD.id) THEN
      RAISE EXCEPTION 'shipment_credential_binding_immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_managed_shipping_identity_guard BEFORE UPDATE ON integration
FOR EACH ROW EXECUTE FUNCTION integration_managed_shipping_identity_guard();
