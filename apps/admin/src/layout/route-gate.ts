import type { AdminOperationPermission } from "@fluxkit/api-client";

/**
 * The permission gate of the shell: whether the signed-in role may open the matched route. A path without a route handle (the
 * not-found page) is open, since it shows nothing of any area. The API checks every call again; this keeps a page that only
 * shows "not allowed" from mounting and asking.
 */
export function mayOpenRoute(
  handle: { permission: AdminOperationPermission } | undefined,
  can: (permission: AdminOperationPermission) => boolean,
): boolean {
  return handle === undefined || can(handle.permission);
}
