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

/**
 * Whether the request reached the API without passing a trusted proxy: Express `trust proxy` is a hop count above 0 (set by
 * `createApp` from `TRUST_PROXY`) and no address was taken from `X-Forwarded-For` (`request.ips` is empty). Any other
 * `trust proxy` value is treated as "came through a proxy", so the request is counted.
 */
function bypassedTrustedProxies(request: Request): boolean {
  const trustedHops: unknown = request.app.get("trust proxy");
  return typeof trustedHops === "number" && trustedHops > 0 && request.ips.length === 0;
}

/**
 * The key a request is counted under for the named limit (see `RATE_LIMIT_SUBJECTS`), or `undefined` when this request is
 * not counted (a `proxiedClientAddress` limit and a request from inside the deployment).
 */
function clientKeyOf(name: RateLimitName, request: Request): string | undefined {
  const subject = RATE_LIMIT_SUBJECTS[name];
  if (subject === "account") {
    // A programming error: such a limit is counted by its service with a key from the body or the principal.
    throw new Error(`The rate limit "${name}" is counted by its service, not by @RateLimit`);
  }
  if (subject === "adminUser") {
    const principal = getCurrentAdmin(request);
    if (principal === undefined) {
      // A programming error (the limit is on a route without AdminGuard): a logged 500, never an unlimited pass.
      throw new Error(`The rate limit "${name}" needs a signed-in admin; put it on an admin route`);
    }
    return `admin-user:${principal.userId}`;
  }
  if (subject === "proxiedClientAddress" && bypassedTrustedProxies(request)) {
    return undefined;
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
    const clientKey = clientKeyOf(name, request);
    if (clientKey === undefined) {
      return true;
    }
    const decision = this.limiter.attempt(name, clientKey);
    if (!decision.allowed) {
      throw tooManyRequests("Too many requests. Try again later.", decision.retryAfterSeconds);
    }
    return true;
  }
}
