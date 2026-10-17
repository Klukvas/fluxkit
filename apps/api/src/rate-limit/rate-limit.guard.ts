import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { tooManyRequests } from "../common/problem.js";
import { RATE_LIMIT_KEY, RateLimiter, type RateLimitName } from "./rate-limiter.js";

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
    // `request.ip` is the socket address unless Express `trust proxy` is set (see IpWindowLimiter).
    const decision = this.limiter.attempt(name, request.ip ?? "unknown");
    if (!decision.allowed) {
      throw tooManyRequests("Too many requests. Try again later.", decision.retryAfterSeconds);
    }
    return true;
  }
}
