import type { IncomingMessage } from "node:http";
import { MARKDOWN_LIMITS } from "@fluxkit/core";
import { isAdminPath } from "./admin-path.js";

/*
 * JSON request body limits. Every route keeps Express's default (100 kB) except the admin content area: a feature's
 * Markdown body may hold MARKDOWN_LIMITS.maxLength UTF-16 units per content locale (blog plan section 8), and one save sends
 * every locale at once, which is far above 100 kB outside Latin scripts (two Cyrillic bodies are about 160 kB).
 *
 * The scope is `/admin` as a whole, so a feature never needs a core line of its own, minus `/admin/auth` (sign-in and the
 * session routes keep the default, like the other unauthenticated routes: sign-in, checkout, customers, store). The body is
 * parsed before the admin guard runs, so a signed-out caller may also send up to this limit to an `/admin` route before its
 * 401; it stays below 1 MB for two locales, one bounded JSON.parse.
 */

/** Express's own default, which every route outside the admin content area keeps (`express.json()` without a limit). */
export const DEFAULT_JSON_BODY_LIMIT_BYTES = 100 * 1024;

/** The longest JSON spelling of one UTF-16 unit: a `\uXXXX` escape (a raw character is at most 3 bytes per unit). */
const MAX_JSON_BYTES_PER_UTF16_UNIT = 6;

/** Room for everything else a content save carries: the other texts of every locale, ids, keys and punctuation. */
const ADMIN_JSON_HEADROOM_BYTES = 256 * 1024;

/** The admin JSON limit for `localeCount` content locales: one full Markdown body per locale, at worst, plus headroom. */
export function adminJsonBodyLimitBytes(localeCount: number): number {
  return (
    Math.max(1, localeCount) * MARKDOWN_LIMITS.maxLength * MAX_JSON_BYTES_PER_UTF16_UNIT +
    ADMIN_JSON_HEADROOM_BYTES
  );
}

const ADMIN_AUTH_PATH = /^\/admin\/auth(?:\/|$)/i;

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * The `type` check of the admin JSON parser: a JSON body sent to an `/admin` route outside `/admin/auth` (paths matched like
 * the admin guard does, case-insensitively). Anything else falls through to the default parser and its 100 kB limit.
 */
export function isAdminContentJsonRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?")[0] ?? "";
  return (
    isAdminPath(path) &&
    !ADMIN_AUTH_PATH.test(path) &&
    mediaType(request.headers["content-type"]) === "application/json"
  );
}
