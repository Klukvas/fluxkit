import { ADMIN_OPERATIONS } from "@fluxkit/api-client";
import {
  ORDER_STATUSES,
  ROLE_PERMISSIONS,
  decideTransition,
  type OrderStatus,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  ORDER_ACTIONS,
  ORDER_ACTION_OPERATIONS,
  ORDER_ACTION_TARGETS,
  offeredActions,
} from "./order-actions";

const OWNER = [...ROLE_PERMISSIONS.owner];
const MANAGER = [...ROLE_PERMISSIONS.manager];
const VIEWER = [...ROLE_PERMISSIONS.viewer];

describe("order actions offered per status (hints: the server decides)", () => {
  it("names the API operation of each action, all of them orders.write", () => {
    expect(ORDER_ACTION_OPERATIONS).toEqual({
      markPaid: "markOrderPaid",
      markFulfilled: "markOrderFulfilled",
      cancel: "cancelOrder",
    });
    for (const action of ORDER_ACTIONS) {
      expect(ADMIN_OPERATIONS[ORDER_ACTION_OPERATIONS[action]].permission, action).toBe(
        "orders.write",
      );
    }
  });

  it("offers exactly what core's status table lets an admin do", () => {
    for (const status of ORDER_STATUSES) {
      const expected = ORDER_ACTIONS.filter(
        (action) => decideTransition(status, ORDER_ACTION_TARGETS[action], "admin").ok,
      );
      expect(offeredActions(status, OWNER), status).toEqual(expected);
    }
  });

  it("offers per status, spelled out", () => {
    const table: Record<OrderStatus, string[]> = {
      awaiting_payment: ["markPaid", "cancel"],
      paid: ["markFulfilled", "cancel"],
      fulfilled: [],
      cancelled: [],
      expired: [],
    };
    for (const status of ORDER_STATUSES) {
      expect(offeredActions(status, MANAGER), status).toEqual(table[status]);
    }
  });

  it("offers nothing without orders.write (viewer, signed out, read-only)", () => {
    for (const status of ORDER_STATUSES) {
      expect(offeredActions(status, VIEWER), status).toEqual([]);
      expect(offeredActions(status, null), status).toEqual([]);
      expect(offeredActions(status, ["orders.read"]), status).toEqual([]);
    }
    expect(offeredActions("awaiting_payment", ["orders.write"])).toEqual(["markPaid", "cancel"]);
  });
});
