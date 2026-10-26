import type { AdminRole } from "@fluxkit/core";
import { permissionsOf } from "@fluxkit/core";
import type { AdminAuthenticator, AdminPrincipal } from "../auth/admin-authenticator.js";
import type { StartAppOptions } from "./app.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  type TestAdminUser,
} from "./admin-user-fixtures.js";
import { EmailWorld } from "./email-world.js";
import { http, type HttpOptions, type HttpResult } from "./http.js";

/** TEST ONLY. Signs every request in as whoever the spec chose last (or nobody), so one app serves several admins. */
class SwitchableAuthenticator implements AdminAuthenticator {
  current: AdminPrincipal | undefined;

  authenticate(): AdminPrincipal | undefined {
    return this.current;
  }
}

/**
 * TEST ONLY. The mail world plus real admin users: `signInAs` inserts an `admin_user` row (so `admin_user_id` links hold)
 * and makes it the caller of the next requests. Nothing else differs from `EmailWorld`.
 */
export class EmailAdminWorld {
  private readonly users: string[] = [];

  private constructor(
    readonly world: EmailWorld,
    private readonly authenticator: SwitchableAuthenticator,
  ) {}

  static async start(options: StartAppOptions = {}): Promise<EmailAdminWorld> {
    const authenticator = new SwitchableAuthenticator();
    const world = await EmailWorld.start({ ...options, adminAuthenticator: authenticator });
    return new EmailAdminWorld(world, authenticator);
  }

  /** Creates an admin of `role` and makes it the caller. */
  async signInAs(role: AdminRole = "owner"): Promise<TestAdminUser> {
    const user = await createTestAdminUser(this.world.database, { role });
    this.users.push(user.id);
    this.authenticator.current = principalOf(user);
    return user;
  }

  /** Makes an existing admin the caller again. */
  switchTo(user: TestAdminUser): void {
    this.authenticator.current = principalOf(user);
  }

  /** The next requests are anonymous (401). */
  signOut(): void {
    this.authenticator.current = undefined;
  }

  /** Signs in as a principal that is not stored (a non-ASCII address the mail cannot carry, a role without a row). */
  signInAsPrincipal(principal: AdminPrincipal): void {
    this.authenticator.current = principal;
  }

  call<TBody = unknown>(
    method: "GET" | "POST",
    path: string,
    options: HttpOptions = {},
  ): Promise<HttpResult<TBody>> {
    return http<TBody>(this.world.running.baseUrl, method, path, options);
  }

  async stop(): Promise<void> {
    await this.world.pool.query("delete from email_message");
    await deleteTestAdminUsers(this.world.database, this.users);
    await this.world.stop();
  }
}

function principalOf(user: TestAdminUser): AdminPrincipal {
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    permissions: permissionsOf(user.role),
    sessionId: "00000000-0000-4000-8000-000000000002",
  };
}
