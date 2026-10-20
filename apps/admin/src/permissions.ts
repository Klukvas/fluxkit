import {
  ADMIN_OPERATIONS,
  type AdminOperationName,
  type AdminOperationPermission,
} from "@fluxkit/api-client";

/**
 * The permission table of the UI (plan, "Permissions in the UI"). It is not copied: each route and action names the API
 * operation it needs, and the permission comes from `ADMIN_OPERATIONS`, whose `permission` the client's contract test
 * compares with `x-fluxkit-permission` in `docs/api/openapi.json` (and `permissions.spec.ts` does it again here).
 * Hiding is convenience only: the API decides, and a 403 is handled everywhere.
 */
export function permissionOf(operation: AdminOperationName): AdminOperationPermission {
  return ADMIN_OPERATIONS[operation].permission;
}

/**
 * Whether the signed-in admin may do what `required` names. Reads ONLY the permission list of `GET /admin/auth/me`
 * (`null` when nobody is signed in), never the role name, so the UI follows the API's role table.
 */
export function canAccess(
  permissions: readonly string[] | null,
  required: AdminOperationPermission,
): boolean {
  switch (required) {
    case "public":
      return true;
    case "authenticated":
      return permissions !== null;
    case "denied":
      return false;
    default:
      return permissions !== null && permissions.includes(required);
  }
}

/** Whether the admin may call one operation of the admin API. */
export function canRun(
  permissions: readonly string[] | null,
  operation: AdminOperationName,
): boolean {
  return canAccess(permissions, permissionOf(operation));
}
