import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { unauthorized } from "../common/problem.js";
import { ADMIN_AUTHENTICATOR, type AdminAuthenticator } from "./admin-authenticator.js";

/** Requests the authenticator already allowed, so the global guard and `@AdminController` ask it only once. */
const allowedRequests = new WeakSet<object>();

/** Default deny: a request is served only when the injected authenticator explicitly allows it. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ADMIN_AUTHENTICATOR) private readonly authenticator: AdminAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (allowedRequests.has(request)) {
      return true;
    }
    if ((await this.authenticator.allows(request)) !== true) {
      throw unauthorized();
    }
    allowedRequests.add(request);
    return true;
  }
}

/**
 * Express matches paths case-insensitively and ignores a trailing slash, so `/ADMIN/x` reaches the same handler
 * as `/admin/x`. The test must be just as lenient or it can be bypassed.
 */
const ADMIN_PATH = /^\/admin(?:\/|$)/i;

/**
 * Registered globally (`APP_GUARD`): every route under `/admin` is guarded, also a controller that forgot
 * `@AdminController` and every route of a feature module (features cannot import this API's decorator).
 */
@Injectable()
export class AdminPathGuard implements CanActivate {
  constructor(private readonly adminGuard: AdminGuard) {}

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    if (context.getType() !== "http") {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    return ADMIN_PATH.test(request.path) ? this.adminGuard.canActivate(context) : true;
  }
}
