import type { AdminAuthenticator } from "../auth/admin-authenticator.js";

/** TEST ONLY. Lets every request through so HTTP specs can exercise the admin routes. Never import from src/ outside test/. */
export class AllowAllAdminAuthenticator implements AdminAuthenticator {
  allows(): boolean {
    return true;
  }
}
