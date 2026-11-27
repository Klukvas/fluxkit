ALTER TABLE "integration_credential_version" ADD COLUMN "environment" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_credential_version" ADD CONSTRAINT "integration_credential_version_environment_check" CHECK ("integration_credential_version"."environment" ~ '^[a-z][a-z0-9_]{0,31}$');--> statement-breakpoint
CREATE OR REPLACE FUNCTION integration_credential_identity_and_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.integration_id IS DISTINCT FROM OLD.integration_id
    OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.environment IS DISTINCT FROM OLD.environment THEN
    RAISE EXCEPTION 'integration_credential_identity_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
    (OLD.state = 'candidate' AND NEW.state IN ('active', 'retired', 'revoked')) OR
    (OLD.state = 'active' AND NEW.state IN ('draining', 'revoked')) OR
    (OLD.state = 'draining' AND NEW.state IN ('active', 'revoked', 'retired'))
  ) THEN
    RAISE EXCEPTION 'integration_credential_transition_invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_credential_identity_and_state_guard
BEFORE UPDATE ON integration_credential_version
FOR EACH ROW EXECUTE FUNCTION integration_credential_identity_and_state();
