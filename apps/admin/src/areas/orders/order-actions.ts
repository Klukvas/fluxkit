import type { AdminOperationName, OrderStatus } from "@fluxkit/api-client";
import { canRun } from "../../permissions";

/**
 * The status actions of the order detail and when the screen offers them. These are HINTS only: the API decides under
 * its row lock (another admin, the expiry job or the customer may have changed the order since it was read), and its
 * refusal is shown. The table mirrors core's `ORDER_TRANSITIONS` for the actor `admin` (compared in the spec); each
 * action needs the permission of its own operation (`ADMIN_OPERATIONS`), so a viewer is offered nothing.
 */

export const ORDER_ACTIONS = ["markPaid", "markFulfilled", "cancel"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export const ORDER_ACTION_OPERATIONS: Record<OrderAction, AdminOperationName> = {
  markPaid: "markOrderPaid",
  markFulfilled: "markOrderFulfilled",
  cancel: "cancelOrder",
};

/** The status each action leads to. */
export const ORDER_ACTION_TARGETS: Record<OrderAction, OrderStatus> = {
  markPaid: "paid",
  markFulfilled: "fulfilled",
  cancel: "cancelled",
};

/** The statuses an admin may start each action from (core: `awaiting_payment -> paid`, `paid -> fulfilled`, cancel both). */
const FROM: Record<OrderAction, readonly OrderStatus[]> = {
  markPaid: ["awaiting_payment"],
  markFulfilled: ["paid"],
  cancel: ["awaiting_payment", "paid"],
};

/** The actions to offer for an order in `status` to an admin with `permissions`, in display order. */
export function offeredActions(
  status: OrderStatus,
  permissions: readonly string[] | null,
): OrderAction[] {
  return ORDER_ACTIONS.filter(
    (action) =>
      FROM[action].includes(status) && canRun(permissions, ORDER_ACTION_OPERATIONS[action]),
  );
}
