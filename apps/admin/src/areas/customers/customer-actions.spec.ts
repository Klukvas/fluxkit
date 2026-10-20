import { ADMIN_OPERATIONS } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_ACTIONS,
  CUSTOMER_ACTION_OPERATIONS,
  offeredCustomerActions,
  stateAfterUnknown,
  updateBody,
} from "./customer-actions";

const owner = [...ROLE_PERMISSIONS.owner];
const manager = [...ROLE_PERMISSIONS.manager];
const viewer = [...ROLE_PERMISSIONS.viewer];
const active = { isActive: true, isLocked: false };

describe("the actions offered for a customer", () => {
  it("names the API operation of every action, and each needs customers.write", () => {
    expect(CUSTOMER_ACTION_OPERATIONS).toEqual({
      deactivate: "updateCustomer",
      activate: "updateCustomer",
      unlock: "unlockCustomer",
    });
    for (const action of CUSTOMER_ACTIONS) {
      expect(ADMIN_OPERATIONS[CUSTOMER_ACTION_OPERATIONS[action]].permission).toBe(
        "customers.write",
      );
    }
  });

  it("offers deactivate for an active customer and activate for a deactivated one, never both", () => {
    expect(offeredCustomerActions(active, owner)).toEqual(["deactivate"]);
    expect(offeredCustomerActions({ isActive: false, isLocked: false }, owner)).toEqual([
      "activate",
    ]);
  });

  it("offers unlock only while the customer is locked", () => {
    expect(offeredCustomerActions({ isActive: true, isLocked: false }, owner)).not.toContain(
      "unlock",
    );
    expect(offeredCustomerActions({ isActive: true, isLocked: true }, owner)).toEqual([
      "deactivate",
      "unlock",
    ]);
    expect(offeredCustomerActions({ isActive: false, isLocked: true }, owner)).toEqual([
      "activate",
      "unlock",
    ]);
  });

  it("offers the owner and the manager everything and the viewer nothing (core's role table)", () => {
    const locked = { isActive: true, isLocked: true };
    expect(offeredCustomerActions(locked, owner)).toEqual(["deactivate", "unlock"]);
    expect(offeredCustomerActions(locked, manager)).toEqual(["deactivate", "unlock"]);
    expect(offeredCustomerActions(locked, viewer)).toEqual([]);
  });

  it("offers nothing without customers.write, even with every read permission, or without a session", () => {
    const locked = { isActive: true, isLocked: true };
    expect(
      offeredCustomerActions(locked, ["customers.read", "orders.read", "orders.write"]),
    ).toEqual([]);
    expect(offeredCustomerActions(locked, [])).toEqual([]);
    expect(offeredCustomerActions(locked, null)).toEqual([]);
  });
});

describe("the PATCH body", () => {
  it("sends only isActive, true to activate and false to deactivate", () => {
    expect(updateBody("deactivate")).toEqual({ isActive: false });
    expect(updateBody("activate")).toEqual({ isActive: true });
  });
});

describe("what the server has after an answer that never arrived", () => {
  it("says what the stored customer is, not whether the write landed", () => {
    expect(stateAfterUnknown("deactivate", { isActive: false, isLocked: false })).toBe(
      "now_deactivated",
    );
    expect(stateAfterUnknown("deactivate", active)).toBe("still_active");
    expect(stateAfterUnknown("activate", active)).toBe("now_active");
    expect(stateAfterUnknown("activate", { isActive: false, isLocked: false })).toBe(
      "still_deactivated",
    );
    expect(stateAfterUnknown("unlock", { isActive: true, isLocked: false })).toBe("not_locked");
    expect(stateAfterUnknown("unlock", { isActive: true, isLocked: true })).toBe("still_locked");
  });

  it("is unreadable when there is no stored customer to look at", () => {
    for (const action of CUSTOMER_ACTIONS)
      expect(stateAfterUnknown(action, null)).toBe("unreadable");
  });
});
