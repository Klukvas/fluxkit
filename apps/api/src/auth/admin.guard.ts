import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { unauthorized } from "../common/problem.js";
import { ADMIN_AUTHENTICATOR, type AdminAuthenticator } from "./admin-authenticator.js";

/** Default deny: a request is served only when the injected authenticator explicitly allows it. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ADMIN_AUTHENTICATOR) private readonly authenticator: AdminAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if ((await this.authenticator.allows(request)) !== true) {
      throw unauthorized();
    }
    return true;
  }
}
