import { Injectable } from "@nestjs/common";
import type { Request } from "express";

export const ADMIN_AUTHENTICATOR = Symbol("ADMIN_AUTHENTICATOR");

/**
 * Decides whether a request may use the admin API. Contract of the future auth plan: it replaces the provider
 * bound to `ADMIN_AUTHENTICATOR`; `AdminGuard` and the controllers stay as they are.
 * An implementation that throws is treated as "not allowed" for the caller (HTTP 500, logged), never as "allowed".
 */
export interface AdminAuthenticator {
  allows(request: Request): boolean | Promise<boolean>;
}

/**
 * The default authenticator denies everything. The real implementation (sessions or tokens, roles) arrives with
 * the auth plan. There is deliberately no interim backdoor: no environment-variable switch, no API key, no
 * "development mode". Tests inject their own authenticator through `createApp` (see `test/app.ts`).
 */
@Injectable()
export class DenyAllAdminAuthenticator implements AdminAuthenticator {
  allows(): boolean {
    return false;
  }
}
