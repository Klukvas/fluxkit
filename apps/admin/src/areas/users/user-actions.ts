import type {
  AdminOperationName,
  AdminRole,
  AdminUser,
  UpdateAdminUserBody,
} from "@fluxkit/api-client";
import { diffForPatch } from "../../lib/diff-for-patch";
import {
  describeProblem,
  type MessageDescriptor,
  type ProblemLike,
} from "../../lib/problem-messages";
import { canRun } from "../../permissions";

/**
 * The actions of the user detail and how the screen treats them. HINTS only: the API decides (the last-owner rule runs
 * there, under one lock for all owner changes), and its refusal is explained. Each action needs the permission of its own
 * operation (`ADMIN_OPERATIONS`: all of them `users.manage`), read from the session's permission list, never from a role
 * name.
 */

export const USER_ACTIONS = ["changeRole", "deactivate", "activate", "resetPassword"] as const;
export type UserAction = (typeof USER_ACTIONS)[number];

export const USER_ACTION_OPERATIONS: Record<UserAction, AdminOperationName> = {
  changeRole: "updateUser",
  deactivate: "updateUser",
  activate: "updateUser",
  resetPassword: "resetUserPassword",
};

/** The actions to offer, in display order: role change, deactivate or activate (by the stored activity), password reset. */
export function offeredUserActions(
  user: { isActive: boolean },
  permissions: readonly string[] | null,
): UserAction[] {
  const wanted: UserAction[] = [
    "changeRole",
    user.isActive ? "deactivate" : "activate",
    "resetPassword",
  ];
  return wanted.filter((action) => canRun(permissions, USER_ACTION_OPERATIONS[action]));
}

/** The stored fields a PATCH can change (`{role?, isActive?}`; the API refuses any other field). */
function patchable(user: AdminUser): { role: AdminRole; isActive: boolean } {
  return { role: user.role, isActive: user.isActive };
}

/**
 * The actor's own password goes with the request only when there is one to send (`""` is nothing) and the patch changes
 * something: an empty patch is never sent, so it carries nothing either.
 */
function withStepUp(patch: UpdateAdminUserBody, currentPassword?: string): UpdateAdminUserBody {
  const nothingToSend = Object.keys(patch).length === 0;
  return nothingToSend || currentPassword === undefined || currentPassword === ""
    ? patch
    : { ...patch, currentPassword };
}

/** `PATCH /admin/users/{id}` for a role change: `{role}` when it differs, `{}` (send nothing) when it does not. */
export function rolePatch(
  user: AdminUser,
  role: AdminRole,
  currentPassword?: string,
): UpdateAdminUserBody {
  return withStepUp(diffForPatch(patchable(user), { role }), currentPassword);
}

/** `PATCH /admin/users/{id}` for the activity: `{isActive}` when it differs, `{}` otherwise. */
export function activityPatch(
  user: AdminUser,
  isActive: boolean,
  currentPassword?: string,
): UpdateAdminUserBody {
  return withStepUp(diffForPatch(patchable(user), { isActive }), currentPassword);
}

/**
 * Which actions ask the signed-in admin for their OWN password again (`docs/api/auth.md`, ADR 0058): the results that
 * would otherwise let a stolen owner session mint an owner account or a password it knows. A HINT like the actions
 * themselves: the API decides on the locked user and refuses with `owner_step_up_required` when the answer moved.
 */
export function needsOwnerStepUp(
  action: UserAction,
  user: { role: AdminRole; isActive: boolean },
  nextRole?: AdminRole,
): boolean {
  switch (action) {
    case "changeRole":
      return nextRole === "owner" && user.role !== "owner";
    case "activate":
      return user.role === "owner";
    case "resetPassword":
      return user.role === "owner";
    case "deactivate":
      return false;
  }
}

export interface Confirmation {
  /** A confirmation dialog comes before the request. */
  ask: boolean;
  tone: "default" | "danger";
  /** The owner acts on their own account: an extra explicit tick is required before the confirm button works. */
  selfCheck: boolean;
  /** The dialog asks for the actor's current password and sends it with the request. */
  stepUp: boolean;
}

/**
 * The plan's confirmation list: role changes, deactivating an admin user (ends their sessions) and password resets (end
 * all sessions of that user). Activating needs none, unless it reactivates an owner, which needs the password re-entry
 * and therefore a dialog to type it in. Changing one's OWN role or activity also needs an explicit tick.
 */
export function confirmationOf(action: UserAction, self: boolean, stepUp = false): Confirmation {
  switch (action) {
    case "changeRole":
      return { ask: true, tone: "default", selfCheck: self, stepUp };
    case "deactivate":
      return { ask: true, tone: "danger", selfCheck: self, stepUp };
    case "resetPassword":
      return { ask: true, tone: "danger", selfCheck: false, stepUp };
    case "activate":
      return { ask: stepUp, tone: "default", selfCheck: false, stepUp };
  }
}

/**
 * Whether the confirm button may send: not while a required tick is missing, and not while a required password field is
 * empty (an empty one would spend one of the five attempts the API allows per 15 minutes for nothing).
 */
export function mayConfirm(
  confirmation: Confirmation,
  selfTicked: boolean,
  stepUpPassword = "",
): boolean {
  if (confirmation.selfCheck && !selfTicked) return false;
  return !confirmation.stepUp || stepUpPassword !== "";
}

export type SelfConsequence = "losesUsersArea" | "signedOutCannotSignIn" | "signedOutSignInAgain";

/**
 * What an action on the signed-in owner's own account does to their session, as `docs/api/auth.md` states it: a role
 * other than owner applies to the next request (the users area is gone then); deactivating ends all their sessions and
 * sign-in is refused while inactive; a password reset ends ALL their sessions, the current one too.
 */
export function selfConsequence(
  action: UserAction,
  self: boolean,
  nextRole?: AdminRole,
): SelfConsequence | null {
  if (!self) return null;
  switch (action) {
    case "changeRole":
      return nextRole !== undefined && nextRole !== "owner" ? "losesUsersArea" : null;
    case "deactivate":
      return "signedOutCannotSignIn";
    case "resetPassword":
      return "signedOutSignInAgain";
    case "activate":
      return null;
  }
}

/** The `rule` of a 403 that means "the password was wrong", not "the role may not do this" (ADR 0058). */
export const PASSWORD_INCORRECT_RULE = "current_password_incorrect";

/** The refusals this area explains itself: each `rule` with the problem `code` it belongs to. */
const OWN_RULES: Readonly<Record<string, string | undefined>> = Object.freeze({
  last_owner_cannot_be_demoted: "rule_violation",
  last_owner_cannot_be_deactivated: "rule_violation",
  owner_step_up_required: "rule_violation",
  step_up_unavailable: "service_unavailable",
});

/**
 * A refusal of a user action: the last-owner rules and the password re-entry get the area's own explanation (what to do
 * instead); everything else goes through the shell's problem map. The API's English `detail` is never shown.
 */
export function describeUserRefusal(status: number, problem: ProblemLike): MessageDescriptor {
  if (status === 403 && problem.rule === PASSWORD_INCORRECT_RULE) {
    return { key: `user.refusal.${PASSWORD_INCORRECT_RULE}` };
  }
  if (problem.rule !== undefined && OWN_RULES[problem.rule] === problem.code) {
    return { key: `user.refusal.${problem.rule}` };
  }
  return describeProblem(status, problem);
}

export type StateAfterUnknown =
  | { kind: "roleIs"; role: AdminRole; changed: boolean }
  | { kind: "now_deactivated" }
  | { kind: "still_active" }
  | { kind: "now_active" }
  | { kind: "still_deactivated" }
  | { kind: "password_unknown" }
  | { kind: "unreadable" };

/**
 * After an answer that never arrived the screen reads the user again; this says what the stored user is. It never claims
 * the write landed (another owner may have done the same), and nothing is sent again by the screen. A password reset
 * leaves no trace in the user the API returns, so its result stays unknown.
 */
export function stateAfterUnknown(
  action: UserAction,
  sentRole: AdminRole | undefined,
  stored: AdminUser | null,
): StateAfterUnknown {
  if (stored === null) return { kind: "unreadable" };
  switch (action) {
    case "changeRole":
      return { kind: "roleIs", role: stored.role, changed: stored.role === sentRole };
    case "deactivate":
      return stored.isActive ? { kind: "still_active" } : { kind: "now_deactivated" };
    case "activate":
      return stored.isActive ? { kind: "now_active" } : { kind: "still_deactivated" };
    case "resetPassword":
      return { kind: "password_unknown" };
  }
}
