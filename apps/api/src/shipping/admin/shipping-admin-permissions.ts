import type { DefaultPermissions } from "../../auth/route-access.js";

/** Every `/admin/shipping` route needs `shipping.manage`, reads included (ADR 0029 decision 13). */
export const SHIPPING_ADMIN_PERMISSIONS: DefaultPermissions = Object.freeze({
  read: "shipping.manage",
  write: "shipping.manage",
});
