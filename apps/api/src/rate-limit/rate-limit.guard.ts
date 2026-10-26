import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { getCurrentAdmin } from "../auth/current-admin.js";
import { tooManyRequests } from "../common/problem.js";
import {
  RATE_LIMIT_KEY,
  RATE_LIMIT_SUBJECTS,
  RateLimiter,
  type RateLimitName,
} from "./rate-limiter.js";

/** The key a request is counted under for the named limit (see `RATE_LIMIT_SUBJECTS`). */
function clientKeyOf(name: RateLimitName, request: Request): string {
  if (RATE_LIMIT_SUBJECTS[name] === "account") {
    // A programming error: such a limit is counted by its service with a key from the body or the principal.
    throw new Error(`The rate limit "${name}" is counted by its service, not by @RateLimit`);
  }
  if (RATE_LIMIT_SUBJECTS[name] === "adminUser") {
    const principal = getCurrentAdmin(request);
    if (principal === undefined) {
      // A programming error (the limit is on a route without AdminGuard): a logged 500, never an unlimited pass.
      throw new Error(`The rate limit "${name}" needs a signed-in admin; put it on an admin route`);
    }
    return `admin-user:${principal.userId}`;
  }
  // `request.ip` is the socket address unless Express `trust proxy` is set (see IpWindowLimiter).
  return request.ip ?? "unknown";
}

/** Applies the limit named by `@RateLimit`. A route without it is not limited. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const name = this.reflector.getAllAndOverride<RateLimitName | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (name === undefined) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const decision = this.limiter.attempt(name, clientKeyOf(name, request));
    if (!decision.allowed) {
      throw tooManyRequests("Too many requests. Try again later.", decision.retryAfterSeconds);
    }
    return true;
  }
}
