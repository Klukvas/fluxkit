import { classified, many, none } from "./builders.js";
import type { Inventory } from "./types.js";

const ACTOR_REASON = "Admin actor id; admin ids are not exported.";
const ENVELOPE_REASON =
  "An encrypted credential of the shop's own provider account (ADR 0058): no shopper's data, never exported or returned by any API, removed only when the owner retires it.";

/** The integration store (plan row D26): provider identities, credential versions and their encrypted envelopes. */
export const integrationTables: Inventory = {
  integration_revision: none("D26", "id", "revision", "updated_at"),

  integration: {
    ...none(
      "D26",
      "id",
      "kind",
      "provider_code",
      "enabled",
      "active_outbound_version_id",
      "created_at",
      "updated_at",
    ),
    updated_by: classified("staff", "D26", "excluded", "set_null", ACTOR_REASON),
  },

  integration_credential_version: {
    ...none(
      "D26",
      "id",
      "integration_id",
      "generation",
      "purpose",
      "environment",
      "state",
      "created_at",
      "retired_at",
      "revoked_at",
    ),
    created_by: classified("staff", "D26", "excluded", "set_null", ACTOR_REASON),
  },

  integration_merchant_baseline: {
    ...none(
      "D26",
      "id",
      "integration_id",
      "kind",
      "provider_code",
      "environment",
      "enrollment_source",
      "created_at",
    ),
    created_by: classified("staff", "D26", "excluded", "set_null", ACTOR_REASON),
    ...many(
      classified(
        "encrypted_secret",
        "D26",
        "excluded",
        "out_of_scope",
        "Permanent encrypted merchant identity of the shop; never exported or erased by shopper requests, and retained across provider lifecycle changes.",
      ),
      "key_id",
      "nonce",
      "ciphertext",
      "tag",
    ),
  },

  integration_secret: {
    ...none("D26", "id", "version_id", "field", "created_at"),
    ...many(
      classified("encrypted_secret", "D26", "excluded", "out_of_scope", ENVELOPE_REASON),
      "key_id",
      "nonce",
      "ciphertext",
      "tag",
    ),
  },
};
