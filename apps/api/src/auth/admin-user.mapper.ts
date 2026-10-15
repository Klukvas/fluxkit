import { isAdminRole } from "@fluxkit/core";
import type { AdminUserRow } from "./admin-user.repository.js";
import type { AuthUserResponse } from "./auth.schemas.js";

/**
 * Database row -> API shape of a user as the auth endpoints show it. Fields are copied one by one (an allow list),
 * so a column added to `admin_user` later (the password hash above all) can never leak by accident.
 */
export function toAuthUser(row: AdminUserRow): AuthUserResponse {
  if (!isAdminRole(row.role)) {
    // The CHECK constraint makes this impossible; fail loudly instead of sending an unknown role to a client.
    throw new Error(`User ${row.id} has an unknown role`);
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt === null ? null : row.lastLoginAt.toISOString(),
  };
}
