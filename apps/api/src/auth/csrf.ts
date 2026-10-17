import type { Request } from "express";
import { forbidden } from "../common/problem.js";

export const CSRF_HEADER = "x-fluxkit-csrf";
export const CSRF_HEADER_VALUE = "1";

/** Methods that never change state. Everything else, including unusual methods, needs the header. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hasBody(request: Request): boolean {
  const length = request.headers["content-length"];
  return (
    (length !== undefined && length !== "0") || request.headers["transfer-encoding"] !== undefined
  );
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/** Which API the request belongs to; only the error message differs. */
export type CsrfScope = "admin" | "store";

/**
 * Cross-site request forgery defence on top of `SameSite` cookies (ADR 0009 for `/admin`, ADR 0016 for `/store`): a
 * state-changing request must carry `X-Fluxkit-CSRF: 1`, and `Content-Type: application/json` when it has a body. A
 * page on another origin cannot add a custom header without a CORS preflight, and this API never answers a
 * preflight with permission.
 */
export function assertCsrfSafe(request: Request, scope: CsrfScope = "admin"): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return;
  }
  if (request.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    throw forbidden(`State-changing ${scope} requests must send the header X-Fluxkit-CSRF: 1.`);
  }
  if (hasBody(request) && !isJson(request.headers["content-type"])) {
    throw forbidden(
      `State-changing ${scope} requests with a body must use Content-Type: application/json.`,
    );
  }
}
