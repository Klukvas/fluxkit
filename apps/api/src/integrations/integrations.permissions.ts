import type { DefaultPermissions } from "../auth/route-access.js";

/** Owner only (ADR 0058): reading the screen already tells which providers hold credentials. */
export const INTEGRATIONS_ADMIN_PERMISSIONS: DefaultPermissions = Object.freeze({
  read: "integrations.manage",
  write: "integrations.manage",
});
