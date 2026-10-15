import type { Request, Response } from "express";

/**
 * Express matches paths case-insensitively and ignores a trailing slash, so `/ADMIN/x` reaches the same handler
 * as `/admin/x`. Every check on "is this an admin request" must be just as lenient or it can be bypassed.
 */
const ADMIN_PATH = /^\/admin(?:\/|$)/i;

export function isAdminPath(path: string): boolean {
  return ADMIN_PATH.test(path);
}

/**
 * Admin responses carry personal data and session state and must never be stored by a browser or a shared cache
 * (errors included: 401, 403, 429). The problem filter calls this too, for failures that happen before any
 * middleware runs (a body-parser 413).
 */
export function markAdminResponseUncacheable(
  request: Pick<Request, "path">,
  response: Pick<Response, "setHeader">,
): void {
  if (isAdminPath(request.path)) {
    response.setHeader("Cache-Control", "no-store");
  }
}
