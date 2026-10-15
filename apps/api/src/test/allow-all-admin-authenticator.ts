import type { AdminRole } from "@fluxkit/core";
import { permissionsOf } from "@fluxkit/core";
import type { AdminAuthenticator, AdminPrincipal } from "../auth/admin-authenticator.js";

/** A fixed identity for tests that do not sign in. */
export function testPrincipal(role: AdminRole = "owner"): AdminPrincipal {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    email: `test-${role}@example.test`,
    role,
    permissions: permissionsOf(role),
    sessionId: "00000000-0000-4000-8000-000000000002",
  };
}

/**
 * TEST ONLY. Treats every request as signed in as one fixed user, an OWNER unless told otherwise, so HTTP specs
 * can exercise the admin routes. Never import from src/ outside test/.
 */
export class AllowAllAdminAuthenticator implements AdminAuthenticator {
  constructor(private readonly role: AdminRole = "owner") {}

  authenticate(): AdminPrincipal {
    return testPrincipal(this.role);
  }
}
