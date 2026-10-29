import { classified, many } from "./builders.js";
import type { Inventory } from "./types.js";

const REQUEST_PROOF =
  "Proof that a request was answered and the data to re-apply an erasure after a backup restore; never contact data. Deleted by job 12 after the retention period (ADR 0033 decision 8).";
const AUDIT_RECORD =
  "The shop's accountability record of an admin action; it never holds contact data, so it survives the subject's erasure. Deleted by job 12 after one year (ADR 0033 decision 9).";
const ADMIN_ID = "Admin actor id; admin ids are not exported.";

/** Privacy requests and the admin audit log (plan row D25, migration 0009). */
export const privacyTables: Inventory = {
  privacy_request: {
    ...many(
      classified("pseudonymous", "D25", "included", "keep", REQUEST_PROOF),
      "id",
      "kind",
      "subject_kind",
      "channel",
      "status",
      "received_at",
      "due_at",
      "completed_at",
      "result",
    ),
    subject_customer_id: classified(
      "pseudonymous",
      "D25",
      "excluded",
      "keep",
      "Internal id of a possibly deleted customer, kept to re-apply the erasure after a backup restore. " +
        REQUEST_PROOF,
    ),
    subject_email_hash: classified(
      "secret_hash",
      "D25",
      "excluded",
      "keep",
      "HMAC of the address, never the address; a hash is never exported. " + REQUEST_PROOF,
    ),
    note: classified(
      "free_text",
      "D25",
      "excluded",
      "keep",
      "Admin free text (how the identity was checked), labelled 'no personal data' in the admin UI. " +
        REQUEST_PROOF,
    ),
    handled_by: classified("staff", "D25", "excluded", "set_null", ADMIN_ID),
  },

  admin_audit_event: {
    ...many(
      classified("pseudonymous", "D25", "excluded", "keep", AUDIT_RECORD),
      "id",
      "created_at",
      "action",
      "target_kind",
      "target_id",
      "detail",
    ),
    admin_user_id: classified("staff", "D25", "excluded", "set_null", ADMIN_ID),
  },
};
