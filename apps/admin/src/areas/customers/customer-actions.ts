import type { AdminOperationName, UpdateAdminCustomerBody } from "@fluxkit/api-client";
import { canRun } from "../../permissions";

/**
 * The actions of the customer detail and when the screen offers them. These are HINTS only: the API decides, and its
 * refusal is shown. Each action needs the permission of its own operation (`ADMIN_OPERATIONS`: both `PATCH` and `unlock`
 * need `customers.write`), so a viewer, or a session with only `customers.read`, is offered nothing.
 */

export const CUSTOMER_ACTIONS = ["deactivate", "activate", "unlock"] as const;
export type CustomerAction = (typeof CUSTOMER_ACTIONS)[number];

export const CUSTOMER_ACTION_OPERATIONS: Record<CustomerAction, AdminOperationName> = {
  deactivate: "updateCustomer",
  activate: "updateCustomer",
  unlock: "unlockCustomer",
};

/** The facts about a customer that decide what to offer. */
export interface CustomerFacts {
  isActive: boolean;
  isLocked: boolean;
}

/**
 * The actions to offer for a customer to an admin with `permissions`, in display order: deactivate or activate (by the
 * stored activity), and unlock only while a lock is in force.
 */
export function offeredCustomerActions(
  customer: CustomerFacts,
  permissions: readonly string[] | null,
): CustomerAction[] {
  const wanted: CustomerAction[] = [customer.isActive ? "deactivate" : "activate"];
  if (customer.isLocked) wanted.push("unlock");
  return wanted.filter((action) => canRun(permissions, CUSTOMER_ACTION_OPERATIONS[action]));
}

/** The body of `PATCH /admin/customers/{id}`: only the activity changes there. */
export function updateBody(action: "deactivate" | "activate"): UpdateAdminCustomerBody {
  return { isActive: action === "activate" };
}

export type StateAfterUnknown =
  | "now_deactivated"
  | "still_active"
  | "now_active"
  | "still_deactivated"
  | "not_locked"
  | "still_locked"
  | "unreadable";

/**
 * After an answer that never arrived the screen reads the customer again; this says what the stored customer is. It does
 * not claim the write landed (another admin may have done the same), and nothing is sent again by the screen.
 */
export function stateAfterUnknown(
  action: CustomerAction,
  stored: CustomerFacts | null,
): StateAfterUnknown {
  if (stored === null) return "unreadable";
  switch (action) {
    case "deactivate":
      return stored.isActive ? "still_active" : "now_deactivated";
    case "activate":
      return stored.isActive ? "now_active" : "still_deactivated";
    case "unlock":
      return stored.isLocked ? "still_locked" : "not_locked";
  }
}
