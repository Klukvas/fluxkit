import type { AdminPermission, AdminRole } from "@fluxkit/core";
import type { Request } from "express";

export const ADMIN_AUTHENTICATOR = Symbol("ADMIN_AUTHENTICATOR");

/** Who is calling, as decided by the authenticator for this request. Controllers read it with `@CurrentAdmin()`. */
export interface AdminPrincipal {
  userId: string;
  email: string;
  role: AdminRole;
  permissions: readonly AdminPermission[];
  sessionId: string;
}

/**
 * Identifies the caller of an admin request. `undefined` means "not signed in" (the guard answers 401); a principal
 * is checked against the route's permission by `AdminGuard` (403 when missing). An implementation that throws is
 * treated as "not allowed" for the caller (HTTP 500, logged), never as "allowed".
 * Tests inject their own through `createApp` (see `test/app.ts`); there is no environment switch or backdoor.
 */
export interface AdminAuthenticator {
  authenticate(request: Request): AdminPrincipal | undefined | Promise<AdminPrincipal | undefined>;
}
