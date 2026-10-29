import { classified, many, none } from "./builders.js";
import type { Inventory } from "./types.js";

const STAFF_REASON =
  "Staff data: admin users are deactivated, never deleted (ADR 0009); staff requests are handled by the employer (plan D18).";

const staffOutOfScope = classified("staff", "D18", "excluded", "out_of_scope", STAFF_REASON);

/** Admin users, their sessions and uploads (plan rows D18, D19, D23). */
export const staffTables: Inventory = {
  admin_user: {
    ...many(staffOutOfScope, "id", "email", "role", "is_active", "created_at", "updated_at"),
    ...many(
      classified("staff", "D18", "excluded", "out_of_scope", STAFF_REASON),
      "failed_login_count",
      "locked_until",
      "last_login_at",
      "password_changed_at",
    ),
    password_hash: classified(
      "secret_hash",
      "D18",
      "excluded",
      "out_of_scope",
      "A hash is never exported. " + STAFF_REASON,
    ),
  },

  admin_session: {
    ...none("D19", "id"),
    user_id: classified(
      "staff",
      "D19",
      "excluded",
      "cascade",
      "Staff data; sessions end with the user.",
    ),
    token_hash: classified(
      "secret_hash",
      "D19",
      "excluded",
      "cascade",
      "A hash is never exported.",
    ),
    ...many(
      classified(
        "staff",
        "D19",
        "excluded",
        "cascade",
        "Staff data; deleted by the session cleanup.",
      ),
      "created_at",
      "last_seen_at",
      "expires_at",
    ),
  },

  media_upload: {
    ...none(
      "D23",
      "id",
      "storage_key",
      "content_type",
      "byte_size",
      "width",
      "height",
      "sha256",
      "created_at",
      "first_attached_at",
    ),
    created_by: classified(
      "staff",
      "D20",
      "excluded",
      "set_null",
      "Admin actor id; admin ids are not exported.",
    ),
  },
};
