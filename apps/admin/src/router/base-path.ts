/**
 * Where the SPA lives on the storefront origin (ADR 0027, owner answer 1). `vite.config.ts` builds with `base` set to this
 * path plus a slash, and the router uses it as its `basename`, so every route path in `src/routes.ts` is relative to it.
 * This file is imported by `vite.config.ts` too: plain constants only.
 */
export const ADMIN_BASE_PATH = "/admin-ui";

/**
 * The admin API's own prefix rule (`apps/api/src/common/admin-path.ts`): `/admin`, `/admin/...`, any case. `/admin-ui`
 * does not match it. No SPA route may match it, or a deep link could not be told apart from an API request.
 */
export const API_PATH_PATTERN = /^\/admin(?:\/|$)/i;
