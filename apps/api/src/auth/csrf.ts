import { SetMetadata } from "@nestjs/common";
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

/** The media type before any parameter, trimmed and lower-cased (`Application/JSON; charset=x` -> `application/json`). */
function mediaTypeOf(contentType: string | undefined): string | undefined {
  return contentType?.split(";")[0]?.trim().toLowerCase();
}

function isJson(contentType: string | undefined): boolean {
  return mediaTypeOf(contentType) === "application/json";
}

const BINARY_UPLOAD_TYPE = "application/octet-stream";

/** Metadata key of `@AcceptsBinaryUpload()`, read by `AdminGuard` from the route HANDLER only (never the controller). */
export const ACCEPTS_BINARY_UPLOAD_KEY = "fluxkit:admin:accepts-binary-upload";

/**
 * The ONE exception to the JSON rule (ADR 0028 decision 4): the marked admin route accepts a body of exactly
 * `application/octet-stream` (and nothing else, not even JSON); `X-Fluxkit-CSRF: 1` stays required. That type is not
 * CORS-safelisted, so a cross-site page still needs a preflight, which this API never grants. Only
 * `POST /admin/media/uploads` uses it; a route walk in `media-uploads.spec.ts` proves no other route accepts the type.
 * A method decorator on purpose: it cannot be put on a whole controller.
 */
export const AcceptsBinaryUpload = (): MethodDecorator =>
  SetMetadata(ACCEPTS_BINARY_UPLOAD_KEY, true);

export interface CsrfOptions {
  /** Set by `AdminGuard` for a route marked `@AcceptsBinaryUpload()`. `StoreCsrfGuard` never sets it. */
  readonly acceptsBinaryUpload?: boolean;
}

/** Which API the request belongs to; only the error message differs. */
export type CsrfScope = "admin" | "store";

/**
 * Cross-site request forgery defence on top of `SameSite` cookies (ADR 0009 for `/admin`, ADR 0016 for `/store`): a
 * state-changing request must carry `X-Fluxkit-CSRF: 1`, and `Content-Type: application/json` when it has a body (a route
 * marked `@AcceptsBinaryUpload()`: `application/octet-stream` instead, see above). A
 * page on another origin cannot add a custom header without a CORS preflight, and this API never answers a
 * preflight with permission.
 */
export function assertCsrfSafe(
  request: Request,
  scope: CsrfScope = "admin",
  options: CsrfOptions = {},
): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return;
  }
  if (request.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    throw forbidden(`State-changing ${scope} requests must send the header X-Fluxkit-CSRF: 1.`);
  }
  if (options.acceptsBinaryUpload === true) {
    if (hasBody(request) && mediaTypeOf(request.headers["content-type"]) !== BINARY_UPLOAD_TYPE) {
      throw forbidden(
        "This upload route needs Content-Type: application/octet-stream with the header X-Fluxkit-CSRF: 1.",
      );
    }
    return;
  }
  if (hasBody(request) && !isJson(request.headers["content-type"])) {
    throw forbidden(
      `State-changing ${scope} requests with a body must use Content-Type: application/json.`,
    );
  }
}
