import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_ON_HAND as CORE_MAX_ON_HAND, decideAdjustment } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_KINDS,
  MAX_ON_HAND,
  REASON_MAX_LENGTH,
  REFERENCE_MAX_LENGTH,
  modesFor,
  newAdjustmentValues,
  planAdjustment,
  withKind,
  type AdjustmentValues,
} from "./stock-adjustment";

const MAIN = "loc-main";
const level = (onHand: number, reserved = 0) => ({ onHand, reserved });
const single = { locationCount: 1 };
const multi = { locationCount: 2 };

function values(overrides: Partial<AdjustmentValues>): AdjustmentValues {
  return { ...newAdjustmentValues(MAIN), ...overrides };
}

const openapi = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../../../docs/api/openapi.json"), "utf8"),
) as {
  paths: Record<
    string,
    Record<
      string,
      {
        requestBody: {
          content: Record<
            string,
            { schema: { properties: Record<string, Record<string, unknown>> } }
          >;
        };
      }
    >
  >;
};

describe("limits copied from core and the API", () => {
  it("MAX_ON_HAND is core's (10^9)", () => {
    expect(MAX_ON_HAND).toBe(CORE_MAX_ON_HAND);
  });

  it("the kinds and the text limits are the adjustment body's in docs/api/openapi.json", () => {
    const body =
      openapi.paths["/admin/products/{id}/variants/{variantId}/inventory/adjustments"]?.post
        ?.requestBody.content["application/json"]?.schema.properties;
    expect(body?.["kind"]?.["enum"]).toEqual([...ADJUSTMENT_KINDS]);
    expect(body?.["reason"]?.["maxLength"]).toBe(REASON_MAX_LENGTH);
    expect(body?.["reference"]?.["maxLength"]).toBe(REFERENCE_MAX_LENGTH);
  });
});

describe("the form's choices", () => {
  it("starts as a receipt counted as a change, at the default location", () => {
    expect(newAdjustmentValues(MAIN)).toEqual({
      kind: "receipt",
      mode: "delta",
      quantity: "",
      locationId: MAIN,
      reason: "",
      reference: "",
    });
  });

  it("offers the counted quantity only for a correction (adjustment); a receipt or a return adds units", () => {
    expect(modesFor("receipt")).toEqual(["delta"]);
    expect(modesFor("return")).toEqual(["delta"]);
    expect(modesFor("adjustment")).toEqual(["delta", "setOnHand"]);
    expect(withKind(values({ kind: "adjustment", mode: "setOnHand" }), "receipt").mode).toBe(
      "delta",
    );
    expect(withKind(values({ kind: "receipt" }), "adjustment").mode).toBe("delta");
  });
});

describe("planAdjustment: the body", () => {
  it("sends a receipt as a positive delta, without a location when there is only one", () => {
    expect(planAdjustment(values({ quantity: "12" }), level(3), single)).toEqual({
      ok: true,
      body: { kind: "receipt", delta: 12 },
      change: { before: 3, after: 15, delta: 12 },
      confirm: null,
    });
  });

  it("names the chosen location when there are several", () => {
    const plan = planAdjustment(values({ quantity: "1", locationId: "loc-2" }), level(0), multi);
    expect(plan.ok && plan.body).toEqual({ kind: "receipt", delta: 1, locationId: "loc-2" });
  });

  it("needs a location when there are several and none is chosen", () => {
    expect(planAdjustment(values({ quantity: "1", locationId: "" }), level(0), multi)).toEqual({
      ok: false,
      issues: { locationId: "location_required" },
    });
  });

  it("sends a correction that lowers stock as a negative delta and asks to confirm it", () => {
    expect(
      planAdjustment(values({ kind: "adjustment", quantity: "-4" }), level(10, 2), single),
    ).toEqual({
      ok: true,
      body: { kind: "adjustment", delta: -4 },
      change: { before: 10, after: 6, delta: -4 },
      confirm: "lower",
    });
  });

  it("does not ask to confirm a correction that raises stock", () => {
    const plan = planAdjustment(values({ kind: "adjustment", quantity: "4" }), level(1), single);
    expect(plan.ok && plan.confirm).toBeNull();
  });

  it("sends a counted quantity as setOnHand and always asks to confirm it (the server computes the delta at that moment)", () => {
    expect(
      planAdjustment(
        values({ kind: "adjustment", mode: "setOnHand", quantity: "7" }),
        level(10),
        single,
      ),
    ).toEqual({
      ok: true,
      body: { kind: "adjustment", setOnHand: 7 },
      change: { before: 10, after: 7, delta: -3 },
      confirm: "set",
    });
    const raise = planAdjustment(
      values({ kind: "adjustment", mode: "setOnHand", quantity: "12" }),
      level(10),
      single,
    );
    expect(raise.ok && raise.confirm).toBe("set");
  });

  it("trims reason and reference and leaves them out when empty", () => {
    const plan = planAdjustment(
      values({ quantity: "1", reason: "  delivery 42 ", reference: " PO-7 " }),
      level(0),
      single,
    );
    expect(plan.ok && plan.body).toEqual({
      kind: "receipt",
      delta: 1,
      reason: "delivery 42",
      reference: "PO-7",
    });
    const blank = planAdjustment(values({ quantity: "1", reason: "   " }), level(0), single);
    expect(blank.ok && blank.body).toEqual({ kind: "receipt", delta: 1 });
  });

  it("refuses a reason or a reference over the API's limit, counted after trimming", () => {
    const ok = planAdjustment(
      values({ quantity: "1", reason: ` ${"r".repeat(500)} `, reference: "x".repeat(255) }),
      level(0),
      single,
    );
    expect(ok.ok).toBe(true);
    expect(
      planAdjustment(
        values({ quantity: "1", reason: "r".repeat(501), reference: "x".repeat(256) }),
        level(0),
        single,
      ),
    ).toEqual({
      ok: false,
      issues: { reason: "reason_too_long", reference: "reference_too_long" },
    });
  });
});

describe("planAdjustment: the quantity text (whole numbers only, never a float)", () => {
  it("needs a quantity", () => {
    expect(planAdjustment(values({ quantity: "  " }), level(0), single)).toEqual({
      ok: false,
      issues: { quantity: "quantity_required" },
    });
  });

  it("refuses decimals, exponents, signs other than a leading minus, separators and other digits", () => {
    for (const text of [
      "1.5",
      "1,5",
      "1e3",
      "+3",
      "1 000",
      "0x10",
      "٣",
      "--1",
      "-",
      "3-",
      "Infinity",
    ]) {
      expect(
        planAdjustment(values({ kind: "adjustment", quantity: text }), level(5), single),
        text,
      ).toEqual({
        ok: false,
        issues: { quantity: "invalid_quantity" },
      });
    }
  });

  it("refuses minus zero and a minus in a counted quantity", () => {
    expect(
      planAdjustment(values({ kind: "adjustment", quantity: "-0" }), level(5), single),
    ).toEqual({ ok: false, issues: { quantity: "invalid_quantity" } });
    expect(
      planAdjustment(
        values({ kind: "adjustment", mode: "setOnHand", quantity: "-2" }),
        level(5),
        single,
      ),
    ).toEqual({ ok: false, issues: { quantity: "negative_on_hand" } });
  });

  it("refuses a pasted wall of digits as out of range without overflowing", () => {
    expect(planAdjustment(values({ quantity: "9".repeat(40) }), level(0), single)).toEqual({
      ok: false,
      issues: { quantity: "on_hand_out_of_range" },
    });
    expect(
      planAdjustment(
        values({ kind: "adjustment", quantity: `-${"9".repeat(40)}` }),
        level(0),
        single,
      ),
    ).toEqual({ ok: false, issues: { quantity: "negative_on_hand" } });
  });

  it("accepts the exact bound and refuses one more", () => {
    expect(planAdjustment(values({ quantity: "1000000000" }), level(0), single).ok).toBe(true);
    expect(planAdjustment(values({ quantity: "1" }), level(1_000_000_000), single)).toEqual({
      ok: false,
      issues: { quantity: "on_hand_out_of_range" },
    });
  });
});

describe("planAdjustment: the stock rules, predicted from the last read (the server decides under its row lock)", () => {
  it("explains below_reserved: a change that lowers stock below the reserved units", () => {
    expect(
      planAdjustment(values({ kind: "adjustment", quantity: "-3" }), level(5, 4), single),
    ).toEqual({ ok: false, issues: { quantity: "below_reserved" } });
    expect(
      planAdjustment(
        values({ kind: "adjustment", mode: "setOnHand", quantity: "3" }),
        level(5, 4),
        single,
      ),
    ).toEqual({ ok: false, issues: { quantity: "below_reserved" } });
  });

  it("lets a receipt raise stock that stays below a backorder's reserved units", () => {
    expect(planAdjustment(values({ quantity: "1" }), level(0, 5), single).ok).toBe(true);
  });

  it("refuses no change, a receipt or return that removes units, and stock below zero", () => {
    expect(planAdjustment(values({ quantity: "0" }), level(5), single)).toEqual({
      ok: false,
      issues: { quantity: "no_change" },
    });
    expect(planAdjustment(values({ kind: "return", quantity: "-1" }), level(5), single)).toEqual({
      ok: false,
      issues: { quantity: "kind_requires_increase" },
    });
    expect(
      planAdjustment(values({ kind: "adjustment", quantity: "-6" }), level(5), single),
    ).toEqual({ ok: false, issues: { quantity: "negative_on_hand" } });
    expect(
      planAdjustment(
        values({ kind: "adjustment", mode: "setOnHand", quantity: "5" }),
        level(5),
        single,
      ),
    ).toEqual({ ok: false, issues: { quantity: "no_change" } });
  });

  it("decides exactly like core's decideAdjustment for every kind, mode, quantity and level", () => {
    const levels = [
      level(0),
      level(5),
      level(5, 5),
      level(10, 3),
      level(0, 4),
      level(1_000_000_000, 2),
    ];
    const quantities = [
      -1_000_000_001, -11, -10, -7, -5, -2, -1, 0, 1, 2, 5, 7, 999_999_999, 1_000_000_000,
    ];
    let compared = 0;
    for (const kind of ADJUSTMENT_KINDS) {
      for (const mode of modesFor(kind)) {
        for (const current of levels) {
          for (const quantity of quantities) {
            const core = decideAdjustment(
              current,
              mode === "delta" ? { kind, mode, delta: quantity } : { kind, mode, onHand: quantity },
            );
            const plan = planAdjustment(
              values({ kind, mode, quantity: String(quantity) }),
              current,
              single,
            );
            const ours = plan.ok ? null : plan.issues["quantity"];
            expect(ours, `${kind} ${mode} ${quantity} at ${JSON.stringify(current)}`).toBe(
              core.ok ? null : core.reason,
            );
            if (plan.ok && core.ok) {
              expect(plan.change.after).toBe(core.level.onHand);
              expect(plan.change.delta).toBe(core.movement.delta);
            }
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(300);
  });
});
