/**
 * Express matches paths case-insensitively and ignores a trailing slash, so `/STORE/x` reaches the same handler as
 * `/store/x`. Every check on "is this a store request" must be just as lenient or it can be bypassed (same reasoning
 * as `isAdminPath`).
 */
const STORE_PATH = /^\/store(?:\/|$)/i;

export function isStorePath(path: string): boolean {
  return STORE_PATH.test(path);
}
