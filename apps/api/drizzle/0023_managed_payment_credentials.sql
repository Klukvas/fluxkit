CREATE TABLE "integration_merchant_baseline" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider_code" text NOT NULL,
	"environment" text NOT NULL,
	"enrollment_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"key_id" text NOT NULL,
	"nonce" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	CONSTRAINT "integration_merchant_baseline_kind_check" CHECK ("integration_merchant_baseline"."kind" IN ('email', 'payment', 'shipping')),
	CONSTRAINT "integration_merchant_baseline_provider_code_check" CHECK ("integration_merchant_baseline"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "integration_merchant_baseline_environment_check" CHECK ("integration_merchant_baseline"."environment" ~ '^[a-z][a-z0-9_]{0,31}$'),
	CONSTRAINT "integration_merchant_baseline_enrollment_source_check" CHECK ("integration_merchant_baseline"."enrollment_source" = 'first_save'),
	CONSTRAINT "integration_merchant_baseline_key_id_check" CHECK ("integration_merchant_baseline"."key_id" ~ '^[A-Za-z0-9_-]{1,32}$'),
	CONSTRAINT "integration_merchant_baseline_nonce_check" CHECK (octet_length("integration_merchant_baseline"."nonce") = 12),
	CONSTRAINT "integration_merchant_baseline_tag_check" CHECK (octet_length("integration_merchant_baseline"."tag") = 16),
	CONSTRAINT "integration_merchant_baseline_ciphertext_check" CHECK (octet_length("integration_merchant_baseline"."ciphertext") BETWEEN 1 AND 256)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "integration_credential_version_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_merchant_baseline" ADD CONSTRAINT "integration_merchant_baseline_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_merchant_baseline" ADD CONSTRAINT "integration_merchant_baseline_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_merchant_baseline_kind_provider_environment_key" ON "integration_merchant_baseline" USING btree ("kind","provider_code","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_merchant_baseline_integration_environment_key" ON "integration_merchant_baseline" USING btree ("integration_id","environment");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_integration_credential_version_id_fkey" FOREIGN KEY ("integration_credential_version_id") REFERENCES "public"."integration_credential_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_integration_credential_version_id_idx" ON "payment" USING btree ("integration_credential_version_id");--> statement-breakpoint
-- Lock the integration before its version, matching runtime admission and lifecycle writers.
CREATE OR REPLACE FUNCTION payment_credential_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.integration_credential_version_id IS NOT NULL
    AND NEW.integration_credential_version_id IS DISTINCT FROM OLD.integration_credential_version_id THEN
    RAISE EXCEPTION 'payment_credential_binding_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.integration_credential_version_id IS NOT NULL THEN
    SELECT integration_id INTO owner_id FROM integration_credential_version
      WHERE id = NEW.integration_credential_version_id;
    PERFORM 1 FROM integration WHERE id = owner_id AND kind = 'payment'
      AND provider_code = NEW.provider_code FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment_credential_version_mismatch' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM integration_credential_version WHERE id = NEW.integration_credential_version_id
      AND integration_id = owner_id AND purpose = 'outbound' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment_credential_version_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_credential_binding_guard BEFORE INSERT OR UPDATE ON payment
FOR EACH ROW EXECUTE FUNCTION payment_credential_binding_guard();
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER integration_merchant_baseline_guard BEFORE INSERT OR UPDATE OR DELETE ON integration_merchant_baseline
FOR EACH ROW EXECUTE FUNCTION integration_merchant_baseline_guard();
--> statement-breakpoint
CREATE TRIGGER integration_merchant_baseline_truncate_guard BEFORE TRUNCATE ON integration_merchant_baseline
FOR EACH STATEMENT EXECUTE FUNCTION integration_merchant_baseline_guard();
--> statement-breakpoint
-- Changing an integration identity must not invalidate a permanent enrollment or an existing payment's binding.
CREATE OR REPLACE FUNCTION integration_managed_payment_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.provider_code IS DISTINCT FROM OLD.provider_code THEN
    IF EXISTS (SELECT 1 FROM integration_merchant_baseline WHERE integration_id = OLD.id) THEN
      RAISE EXCEPTION 'integration_merchant_baseline_identity_immutable' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM payment p JOIN integration_credential_version v
      ON v.id = p.integration_credential_version_id WHERE v.integration_id = OLD.id) THEN
      RAISE EXCEPTION 'payment_credential_binding_immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_managed_payment_identity_guard BEFORE UPDATE ON integration
FOR EACH ROW EXECUTE FUNCTION integration_managed_payment_identity_guard();
