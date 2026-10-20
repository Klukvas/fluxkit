import type { AdminPermission, AdminRole } from "@fluxkit/api-client";
import type { StatusTone } from "@fluxkit/ui";
import { PATHS, buildPath } from "../../router/paths";

/**
 * How the users area presents what the API answers. Pure. Emails are plain strings that the views render as text only;
 * the only data that reaches a URL is a user's id.
 */

/** The fixed roles of ADR 0009, in core's order (`user-view.spec.ts` compares with `@fluxkit/core` `ROLES`). */
export const USER_ROLES = ["owner", "manager", "viewer"] as const satisfies readonly AdminRole[];

/**
 * What each role may do: exactly core's `ROLE_PERMISSIONS` (copied, because the SPA does not bundle core; the spec
 * compares). The role explanations on the screens list these permissions and nothing more.
 */
export const USER_ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  owner: [
    "catalog.read",
    "catalog.write",
    "catalog.publish",
    "users.manage",
    "orders.read",
    "orders.write",
    "customers.read",
    "customers.write",
  ],
  manager: [
    "catalog.read",
    "catalog.write",
    "catalog.publish",
    "orders.read",
    "orders.write",
    "customers.read",
    "customers.write",
  ],
  viewer: ["catalog.read"],
};

/** The role names are eager messages of the account area (`role.owner`, ...), shown in the user menu too. */
export function roleLabelKey(role: AdminRole): string {
  return `role.${role}`;
}

/** The owner stands out (it manages users); the text always names the role. */
export function roleTone(role: AdminRole): StatusTone {
  return role === "owner" ? "warning" : "neutral";
}

export function permissionLabelKey(permission: AdminPermission): string {
  return `user.permission.${permission}`;
}

export const USER_STATUS_TONES: Record<"active" | "deactivated", StatusTone> = {
  active: "success",
  deactivated: "danger",
};

export function statusLabelKey(isActive: boolean): string {
  return isActive ? "user.status.active" : "user.status.deactivated";
}

export function statusTone(isActive: boolean): StatusTone {
  return USER_STATUS_TONES[isActive ? "active" : "deactivated"];
}

/** A user's detail page. The id is the only thing in the URL. */
export function userHref(id: string): string {
  return buildPath(PATHS.userDetail, { id });
}

/** Whether a row is the signed-in admin's own account: by id from `me`, never by email or role. */
export function isSelf(userId: string, meId: string | null): boolean {
  return meId !== null && userId === meId;
}
