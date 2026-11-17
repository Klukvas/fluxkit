import type { AdminRole } from "@fluxkit/core";

/**
 * Which user-management results ask for the actor's current password again (ADR 0058, plan
 * `docs/plans/2026-11-16-admin-integrations.md` section 8 and its section 11 decision 2). A stolen owner session must
 * not be able to mint an owner account, or a password it knows, and walk through the integrations password re-entry
 * with it. Pure decisions over stored and requested values, so the service can take them twice: once on the unlocked
 * read (to know whether to ask at all) and again on the locked row, which is the one that decides.
 */

/** The audit code of a refused attempt, one per operation; never free text (`docs/api/audit.md`). */
export const OWNER_STEP_UP_OPERATIONS = Object.freeze({
  created: "admin_user.created",
  roleChanged: "admin_user.role_changed",
  activated: "admin_user.activated",
  passwordReset: "admin_user.password_reset",
});

/** The `rule` of the 409 a change gets when its locked result needs a password re-entry that did not happen. */
export const OWNER_STEP_UP_REQUIRED_RULE = "owner_step_up_required";

/** A stored user as the database holds it: `role` is text there, exactly as `decideUserChange` of core takes it. */
export interface UserRoleState {
  readonly role: string;
  readonly isActive: boolean;
}

export interface RoleOrActivityChange {
  readonly role?: AdminRole | undefined;
  readonly isActive?: boolean | undefined;
}

/** Creating a user: only a new owner needs the re-entry. */
export function createNeedsStepUp(role: AdminRole): boolean {
  return role === "owner";
}

/**
 * A role or activity change: promoting a non-owner to owner, or reactivating an owner (the resulting role decides, so
 * one request that promotes AND activates still needs exactly one re-entry). Demoting, deactivating, re-saving an
 * owner as owner and every change of a manager or viewer need none.
 */
export function updateNeedsStepUp(
  target: UserRoleState,
  change: RoleOrActivityChange,
): "roleChanged" | "activated" | null {
  const resultingRole = change.role ?? target.role;
  if (change.role === "owner" && target.role !== "owner") return "roleChanged";
  if (change.isActive === true && !target.isActive && resultingRole === "owner") return "activated";
  return null;
}

/** A password reset: every owner target, active or not, the actor themselves included. */
export function resetNeedsStepUp(target: { readonly role: string }): boolean {
  return target.role === "owner";
}
