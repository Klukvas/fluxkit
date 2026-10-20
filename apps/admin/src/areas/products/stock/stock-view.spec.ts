import type { AdminStockMovement, AdminVariantInventory } from "@fluxkit/api-client";
import { availabilityOf } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  STOCK_STATES,
  STOCK_STATE_TONE,
  actorLabel,
  adjustmentCheck,
  levelAt,
  levelTotals,
  stockState,
} from "./stock-view";

function inventory(overrides: Partial<AdminVariantInventory> = {}): AdminVariantInventory {
  return {
    variantId: "v1",
    trackInventory: true,
    allowBackorder: false,
    levels: [],
    totalAvailable: 0,
    ...overrides,
  };
}

const level = (locationId: string, onHand: number, reserved: number) => ({
  locationId,
  locationCode: locationId,
  onHand,
  reserved,
  available: Math.max(0, onHand - reserved),
});

function movement(id: string, actorId: string | null): AdminStockMovement {
  return {
    id,
    variantId: "v1",
    locationId: "main",
    locationCode: "main",
    kind: "receipt",
    delta: 1,
    onHandAfter: 1,
    reason: null,
    reference: null,
    actorId,
    createdAt: "2026-10-20T10:00:00.000Z",
  };
}

describe("stockState (the badge: text and tone, never a colour alone)", () => {
  it("says not tracked and backorder before any quantity", () => {
    expect(stockState(inventory({ trackInventory: false }), 5)).toBe("not_tracked");
    expect(stockState(inventory({ trackInventory: false, allowBackorder: true }), 5)).toBe(
      "not_tracked",
    );
    expect(stockState(inventory({ allowBackorder: true }), 5)).toBe("backorder");
  });

  it("counts available units over every location against the low-stock threshold", () => {
    expect(stockState(inventory(), 5)).toBe("out_of_stock");
    expect(stockState(inventory({ levels: [level("a", 3, 3)] }), 5)).toBe("out_of_stock");
    expect(stockState(inventory({ levels: [level("a", 3, 0), level("b", 2, 0)] }), 5)).toBe(
      "low_stock",
    );
    expect(stockState(inventory({ levels: [level("a", 6, 0)] }), 5)).toBe("in_stock");
    expect(stockState(inventory({ levels: [level("a", 1, 0)] }), 0)).toBe("in_stock");
  });

  it("matches core's availabilityOf for every tracked case (not tracked and backorder are in stock there)", () => {
    for (const trackInventory of [true, false]) {
      for (const allowBackorder of [true, false]) {
        for (const threshold of [0, 1, 5]) {
          for (const levels of [
            [],
            [level("a", 0, 0)],
            [level("a", 1, 0)],
            [level("a", 5, 0)],
            [level("a", 6, 1)],
            [level("a", 2, 4), level("b", 3, 0)],
            [level("a", 10, 0), level("b", 0, 3)],
          ]) {
            const ours = stockState(
              inventory({ trackInventory, allowBackorder, levels }),
              threshold,
            );
            const core = availabilityOf({ trackInventory, allowBackorder }, levels, threshold);
            const mapped = ours === "not_tracked" || ours === "backorder" ? "in_stock" : ours;
            expect(mapped).toBe(core);
          }
        }
      }
    }
  });

  it("has a tone per state: danger for out of stock, warning for low stock", () => {
    expect(STOCK_STATES.map((state) => STOCK_STATE_TONE[state])).toEqual([
      "success",
      "warning",
      "danger",
      "neutral",
      "neutral",
    ]);
  });
});

describe("levels", () => {
  it("sums on hand and reserved over the locations and takes the available total from the server", () => {
    const stock = inventory({
      levels: [level("a", 10, 2), level("b", 1, 4)],
      totalAvailable: 8,
    });
    expect(levelTotals(stock)).toEqual({ onHand: 11, reserved: 6, available: 8 });
  });

  it("reads the level at one location; a location without a level row holds nothing", () => {
    const stock = inventory({ levels: [level("a", 10, 2)] });
    expect(levelAt(stock, "a")).toEqual({ onHand: 10, reserved: 2 });
    expect(levelAt(stock, "b")).toEqual({ onHand: 0, reserved: 0 });
    expect(levelAt(undefined, "a")).toEqual({ onHand: 0, reserved: 0 });
  });
});

describe("actorLabel (plan, owner answer 11: no API change)", () => {
  const emails = new Map([["u-2", "manager@example.com"]]);

  it("says 'you' for the signed-in admin", () => {
    expect(actorLabel("u-1", "u-1", emails)).toEqual({ kind: "you" });
    expect(actorLabel("u-1", "u-1", null)).toEqual({ kind: "you" });
  });

  it("shows the email when the users list was readable (owners), else another admin with a short id", () => {
    expect(actorLabel("u-2", "u-1", emails)).toEqual({
      kind: "email",
      email: "manager@example.com",
    });
    expect(actorLabel("4f3c2a1b-0000-4000-8000-000000000000", "u-1", null)).toEqual({
      kind: "other",
      shortId: "4f3c2a1b",
    });
    expect(actorLabel("u-3", "u-1", emails)).toEqual({ kind: "other", shortId: "u-3" });
  });

  it("says 'system' for a movement without an admin (orders, the seed, a deleted admin)", () => {
    expect(actorLabel(null, "u-1", emails)).toEqual({ kind: "system" });
  });
});

describe("adjustmentCheck (after an adjustment the journal is reloaded and its newest movement shown)", () => {
  it("tells whether a new movement by this admin, by someone else, or none appeared since the last read", () => {
    expect(adjustmentCheck("m1", movement("m2", "u-1"), "u-1")).toBe("new_by_you");
    expect(adjustmentCheck(null, movement("m1", "u-1"), "u-1")).toBe("new_by_you");
    expect(adjustmentCheck("m1", movement("m2", "u-2"), "u-1")).toBe("new_by_other");
    expect(adjustmentCheck("m1", movement("m1", "u-1"), "u-1")).toBe("none_new");
    expect(adjustmentCheck(null, null, "u-1")).toBe("none_new");
  });
});
