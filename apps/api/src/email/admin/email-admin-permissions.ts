import type { DefaultPermissions } from "../../auth/route-access.js";

/**
 * Every `/admin/email` route needs `email.manage`, reads included: the outbox shows recipient addresses, which are personal
 * data, and the status, test send and preview belong to the same operator (ADR 0031 decision 15).
 */
export const EMAIL_ADMIN_PERMISSIONS: DefaultPermissions = Object.freeze({
  read: "email.manage",
  write: "email.manage",
});
