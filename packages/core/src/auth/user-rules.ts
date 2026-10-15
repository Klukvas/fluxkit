import { isAdminRole } from "./roles.js";

export interface UserChangeInput {
  readonly target: { readonly id: string; readonly role: string; readonly isActive: boolean };
  readonly change: { readonly role?: string; readonly isActive?: boolean };
  /** Ids of all currently active owners, read by the caller inside the same transaction that applies the change. */
  readonly activeOwnerIds: readonly string[];
}

export type UserChangeDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        "last_owner_cannot_be_demoted" | "last_owner_cannot_be_deactivated" | "unknown_role";
    };

/** Keeps at least one active owner, so the admin area can never be locked out of user management. */
export function decideUserChange(input: UserChangeInput): UserChangeDecision {
  const { target, change, activeOwnerIds } = input;
  if (change.role !== undefined && !isAdminRole(change.role)) {
    return { allowed: false, reason: "unknown_role" };
  }
  const isActiveOwner = target.role === "owner" && target.isActive;
  if (!isActiveOwner) {
    return { allowed: true };
  }
  const anotherActiveOwnerRemains = activeOwnerIds.some((id) => id !== target.id);
  if (anotherActiveOwnerRemains) {
    return { allowed: true };
  }
  if (change.role !== undefined && change.role !== "owner") {
    return { allowed: false, reason: "last_owner_cannot_be_demoted" };
  }
  if (change.isActive === false) {
    return { allowed: false, reason: "last_owner_cannot_be_deactivated" };
  }
  return { allowed: true };
}
