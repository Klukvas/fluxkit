import { Inject, Injectable } from "@nestjs/common";
import { permissionsOf } from "@fluxkit/core";
import type { Request } from "express";
import type { AdminAuthenticator, AdminPrincipal } from "./admin-authenticator.js";
import { readSessionCookie } from "./session-cookie.js";
import { SessionService } from "./session.service.js";

/**
 * The production authenticator: session cookie -> session service -> principal. Anything that goes wrong inside
 * (database down, bug) is rethrown and ends as a logged 500; it is never turned into "allowed" or into a silent 401.
 */
@Injectable()
export class SessionAdminAuthenticator implements AdminAuthenticator {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async authenticate(request: Request): Promise<AdminPrincipal | undefined> {
    const token = readSessionCookie(request.headers.cookie);
    if (token === undefined) {
      return undefined;
    }
    const resolved = await this.sessions.resolve(token);
    if (resolved === undefined) {
      return undefined;
    }
    return {
      userId: resolved.user.id,
      email: resolved.user.email,
      role: resolved.user.role,
      permissions: permissionsOf(resolved.user.role),
      sessionId: resolved.sessionId,
    };
  }
}
