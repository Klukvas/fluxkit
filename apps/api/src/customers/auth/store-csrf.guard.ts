import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { assertCsrfSafe } from "../../auth/csrf.js";
import { isStorePath } from "../../common/store-path.js";

/**
 * Registered globally (`APP_GUARD`): every POST, PUT, PATCH and DELETE under `/store` must send
 * `X-Fluxkit-CSRF: 1` (and a JSON content type when it has a body), whether or not the caller is signed in and
 * whatever controller or feature module serves the route (ADR 0016). GET, HEAD and OPTIONS are exempt. It uses the
 * same rule as the admin API (`assertCsrfSafe`) and runs before any route-level guard.
 */
@Injectable()
export class StoreCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    if (isStorePath(request.path)) {
      assertCsrfSafe(request, "store");
    }
    return true;
  }
}
