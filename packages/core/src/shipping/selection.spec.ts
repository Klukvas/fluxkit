import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { SHIPPING_METHOD_KINDS } from "./limits.js";
import type { ShippingMethodKind } from "./limits.js";
import {
  SHIPPING_KIND_RULES,
  checkSelectionForKind,
  decideShippingRequirement,
  parseShippingSelection,
} from "./selection.js";

const REF = "1ec09d88-e1c2-11e3-8c4a-0050568002cf";

describe("parseShippingSelection", () => {
  it("accepts a method code alone and with a pickup point ref", () => {
    expect(parseShippingSelection(deepFreeze({ methodCode: "courier" }))).toEqual({
      ok: true,
      selection: { methodCode: "courier" },
    });
    expect(
      parseShippingSelection(deepFreeze({ methodCode: "np_branch", pickupPointRef: REF })),
    ).toEqual({ ok: true, selection: { methodCode: "np_branch", pickupPointRef: REF } });
  });

  it("treats an undefined pickupPointRef as absent", () => {
    const result = parseShippingSelection({ methodCode: "courier", pickupPointRef: undefined });
    expect(result.ok && Object.hasOwn(result.selection, "pickupPointRef")).toBe(false);
  });

  it.each([null, undefined, "courier", [], 3])("refuses %j as not an object", (value) => {
    expect(parseShippingSelection(value)).toEqual({
      ok: false,
      errors: [{ field: "", reason: "not_an_object" }],
    });
  });

  it("refuses unknown members (a price above all) and reports every error at once", () => {
    expect(
      parseShippingSelection({ methodCode: "Courier", price: 0, pickupPointRef: "a b" }),
    ).toEqual({
      ok: false,
      errors: [
        { field: "price", reason: "unknown_field" },
        { field: "methodCode", reason: "invalid_format" },
        { field: "pickupPointRef", reason: "invalid_format" },
      ],
    });
  });

  it("requires a method code and checks types", () => {
    expect(parseShippingSelection({})).toEqual({
      ok: false,
      errors: [{ field: "methodCode", reason: "required" }],
    });
    expect(parseShippingSelection({ methodCode: 5, pickupPointRef: null })).toEqual({
      ok: false,
      errors: [
        { field: "methodCode", reason: "not_a_string" },
        { field: "pickupPointRef", reason: "not_a_string" },
      ],
    });
  });

  it("refuses refs outside the carrier reference pattern (they would enter a carrier request)", () => {
    for (const ref of ["", "x".repeat(65), "../etc", "a/b", "ref?x=1", "рефер"]) {
      expect(parseShippingSelection({ methodCode: "np", pickupPointRef: ref }).ok, ref).toBe(false);
    }
    expect(parseShippingSelection({ methodCode: "np", pickupPointRef: "x".repeat(64) }).ok).toBe(
      true,
    );
  });
});

describe("decideShippingRequirement", () => {
  const selection = { methodCode: "courier" };

  it("a cart that ships nothing needs no selection and refuses one", () => {
    for (const activeMethodExists of [true, false]) {
      expect(
        decideShippingRequirement({
          cartRequiresShipping: false,
          activeMethodExists,
          selection: undefined,
        }),
      ).toEqual({ ok: true, mode: "none" });
      expect(
        decideShippingRequirement({ cartRequiresShipping: false, activeMethodExists, selection }),
      ).toEqual({ ok: false, reason: "shipping_not_applicable" });
    }
  });

  it("a cart that ships needs a selection once an active method exists", () => {
    expect(
      decideShippingRequirement({
        cartRequiresShipping: true,
        activeMethodExists: true,
        selection: undefined,
      }),
    ).toEqual({ ok: false, reason: "shipping_method_required" });
    expect(
      decideShippingRequirement({
        cartRequiresShipping: true,
        activeMethodExists: true,
        selection,
      }),
    ).toEqual({ ok: true, mode: "method", selection });
  });

  it("a shop without an active method keeps the address-only checkout", () => {
    expect(
      decideShippingRequirement({
        cartRequiresShipping: true,
        activeMethodExists: false,
        selection: undefined,
      }),
    ).toEqual({ ok: true, mode: "none" });
  });

  it("a selection sent to a shop without an active method is priced as usual (and ends in shipping_changed)", () => {
    expect(
      decideShippingRequirement({
        cartRequiresShipping: true,
        activeMethodExists: false,
        selection,
      }),
    ).toEqual({ ok: true, mode: "method", selection });
  });

  it("throws for non-boolean facts (a bug)", () => {
    expect(() =>
      decideShippingRequirement({
        cartRequiresShipping: "yes" as unknown as boolean,
        activeMethodExists: true,
        selection: undefined,
      }),
    ).toThrow(RangeError);
  });
});

describe("checkSelectionForKind", () => {
  it("a pickup_point method needs a ref", () => {
    expect(
      checkSelectionForKind("pickup_point", { methodCode: "np", pickupPointRef: REF }),
    ).toEqual({
      ok: true,
    });
    expect(checkSelectionForKind("pickup_point", { methodCode: "np" })).toEqual({
      ok: false,
      field: "pickupPointRef",
      reason: "required",
    });
  });

  it.each(["address", "store_pickup"] as const)("a %s method refuses a ref", (kind) => {
    expect(checkSelectionForKind(kind, { methodCode: "m" })).toEqual({ ok: true });
    expect(checkSelectionForKind(kind, { methodCode: "m", pickupPointRef: REF })).toEqual({
      ok: false,
      field: "pickupPointRef",
      reason: "not_applicable",
    });
  });

  it("throws for an unknown kind", () => {
    expect(() => checkSelectionForKind("drone" as ShippingMethodKind, { methodCode: "m" })).toThrow(
      RangeError,
    );
  });
});

describe("SHIPPING_KIND_RULES", () => {
  it("has one deeply frozen rule per kind, matching ADR 0029", () => {
    expect(Object.keys(SHIPPING_KIND_RULES).sort()).toEqual([...SHIPPING_METHOD_KINDS].sort());
    expect(SHIPPING_KIND_RULES).toEqual({
      address: { needsAddress: true, needsPickupPoint: false, countryFrom: "address" },
      pickup_point: { needsAddress: false, needsPickupPoint: true, countryFrom: "carrier" },
      store_pickup: {
        needsAddress: false,
        needsPickupPoint: false,
        countryFrom: "address_if_given",
      },
    });
    expect(Object.isFrozen(SHIPPING_KIND_RULES)).toBe(true);
    for (const kind of SHIPPING_METHOD_KINDS) {
      expect(Object.isFrozen(SHIPPING_KIND_RULES[kind])).toBe(true);
    }
  });
});
