import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import type { Money } from "../pricing/money.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import type { CartLine } from "./lines.js";
import { addLine, mergeCarts, removeLine, setLineQuantity } from "./lines.js";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "./limits.js";

const uah = (amount: number): Money => deepFreeze({ amount, currency: "UAH" as const });
const line = (variantId: string, quantity: number, seen: Money | null = null): CartLine =>
  deepFreeze({ variantId, quantity, seen });
const manyLines = (count: number): CartLine[] =>
  Array.from({ length: count }, (_, index) => line(`variant-${index}`, 1));

function okLines(result: { ok: boolean; lines?: readonly CartLine[] }): readonly CartLine[] {
  if (!result.ok || result.lines === undefined) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result.lines;
}

describe("limits", () => {
  it("are the numbers of the plan", () => {
    expect(MAX_CART_LINES).toBe(100);
    expect(MAX_LINE_QUANTITY).toBe(999);
  });
});

describe("addLine", () => {
  it("adds a new line at the end with the seen price", () => {
    const lines = deepFreeze([line("a", 1)]);
    const result = addLine(lines, "b", 2, uah(500));
    expect(result).toEqual({
      ok: true,
      lines: [
        { variantId: "a", quantity: 1, seen: null },
        { variantId: "b", quantity: 2, seen: { amount: 500, currency: "UAH" } },
      ],
    });
  });

  it("adds to an existing line, keeps its position and takes the new seen price", () => {
    const lines = deepFreeze([line("a", 1, uah(100)), line("b", 5, uah(200))]);
    const result = addLine(lines, "a", 3, uah(150));
    expect(okLines(result).map((entry) => [entry.variantId, entry.quantity])).toEqual([
      ["a", 4],
      ["b", 5],
    ]);
    expect(okLines(result)[0]?.seen).toEqual(uah(150));
  });

  it("keeps the old seen price of an existing line when no new one is given", () => {
    const lines = deepFreeze([line("a", 1, uah(100))]);
    expect(okLines(addLine(lines, "a", 1))[0]?.seen).toEqual(uah(100));
  });

  it("allows exactly the line limit and refuses one more (quantity_limit, never a cap)", () => {
    const lines = deepFreeze([line("a", MAX_LINE_QUANTITY - 1)]);
    expect(okLines(addLine(lines, "a", 1))[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    expect(addLine(lines, "a", 2)).toEqual({ ok: false, reason: "quantity_limit" });
    expect(addLine([], "a", MAX_LINE_QUANTITY)).toMatchObject({ ok: true });
    expect(addLine([], "a", MAX_LINE_QUANTITY + 1)).toEqual({
      ok: false,
      reason: "quantity_limit",
    });
  });

  it("refuses quantities that are not integers from 1 up (invalid_quantity)", () => {
    for (const quantity of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0,
      "2",
      null,
      undefined,
    ]) {
      expect(addLine([], "a", quantity as number), String(quantity)).toEqual({
        ok: false,
        reason: "invalid_quantity",
      });
    }
  });

  it("checks the quantity before the cart size", () => {
    const full = deepFreeze(manyLines(MAX_CART_LINES));
    expect(addLine(full, "new", 0)).toEqual({ ok: false, reason: "invalid_quantity" });
  });

  it("refuses a 101st line (too_many_lines) but still adds to an existing line of a full cart", () => {
    const full = deepFreeze(manyLines(MAX_CART_LINES));
    expect(addLine(full, "new", 1)).toEqual({ ok: false, reason: "too_many_lines" });
    const result = addLine(full, "variant-7", 2);
    expect(okLines(result)).toHaveLength(MAX_CART_LINES);
    expect(okLines(result)[7]?.quantity).toBe(3);
  });

  it("allows the 100th line", () => {
    const lines = deepFreeze(manyLines(MAX_CART_LINES - 1));
    expect(okLines(addLine(lines, "new", 1))).toHaveLength(MAX_CART_LINES);
  });

  it("does not mutate its input and returns frozen data", () => {
    const lines = deepFreeze([line("a", 1)]);
    const result = addLine(lines, "b", 1, uah(1));
    expect(lines).toHaveLength(1);
    const output = okLines(result);
    expect(Object.isFrozen(output)).toBe(true);
    for (const entry of output) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(output).not.toBe(lines);
  });

  it("treats a misused variant id, corrupt lines and corrupt seen prices as bugs (RangeError)", () => {
    for (const variantId of ["", undefined, null, 1] as unknown[]) {
      expect(() => addLine([], variantId as string, 1)).toThrow(RangeError);
    }
    expect(() => addLine([line("a", 1), line("a", 2)], "b", 1)).toThrow(RangeError);
    expect(() => addLine([line("a", 0)], "b", 1)).toThrow(RangeError);
    expect(() => addLine([line("a", MAX_LINE_QUANTITY + 1)], "b", 1)).toThrow(RangeError);
    expect(() => addLine(manyLines(MAX_CART_LINES + 1), "b", 1)).toThrow(RangeError);
    expect(() => addLine([line("a", 1, { amount: 1.5, currency: "UAH" })], "b", 1)).toThrow(
      RangeError,
    );
    expect(() => addLine([], "a", 1, { amount: -1, currency: "UAH" })).toThrow(RangeError);
    expect(() => addLine([], "a", 1, { amount: MAX_AMOUNT + 1, currency: "UAH" })).toThrow(
      RangeError,
    );
    expect(() => addLine([], "a", 1, { amount: 1, currency: "XXX" } as unknown as Money)).toThrow(
      RangeError,
    );
  });
});

describe("setLineQuantity", () => {
  it("sets the quantity and the seen price of an existing line", () => {
    const lines = deepFreeze([line("a", 1, uah(100)), line("b", 2)]);
    const result = setLineQuantity(lines, "a", 7, uah(120));
    expect(okLines(result)).toEqual([
      { variantId: "a", quantity: 7, seen: { amount: 120, currency: "UAH" } },
      { variantId: "b", quantity: 2, seen: null },
    ]);
  });

  it("keeps the old seen price when none is given", () => {
    const lines = deepFreeze([line("a", 1, uah(100))]);
    expect(okLines(setLineQuantity(lines, "a", 2))[0]?.seen).toEqual(uah(100));
  });

  it("accepts 1 and 999, refuses 0 and 1000", () => {
    const lines = deepFreeze([line("a", 5)]);
    expect(okLines(setLineQuantity(lines, "a", 1))[0]?.quantity).toBe(1);
    expect(okLines(setLineQuantity(lines, "a", 999))[0]?.quantity).toBe(999);
    expect(setLineQuantity(lines, "a", 0)).toEqual({ ok: false, reason: "invalid_quantity" });
    expect(setLineQuantity(lines, "a", 1000)).toEqual({ ok: false, reason: "quantity_limit" });
    expect(setLineQuantity(lines, "a", 2.5)).toEqual({ ok: false, reason: "invalid_quantity" });
  });

  it("refuses a variant that is not in the cart", () => {
    expect(setLineQuantity(deepFreeze([line("a", 1)]), "zzz", 1)).toEqual({
      ok: false,
      reason: "line_not_found",
    });
  });

  it("checks the quantity before looking for the line", () => {
    expect(setLineQuantity([], "zzz", 0)).toEqual({ ok: false, reason: "invalid_quantity" });
  });

  it("does not mutate its input and returns frozen data", () => {
    const lines = deepFreeze([line("a", 1)]);
    const output = okLines(setLineQuantity(lines, "a", 2));
    expect(lines[0]?.quantity).toBe(1);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output[0])).toBe(true);
  });
});

describe("removeLine", () => {
  it("removes the line and keeps the order of the others", () => {
    const lines = deepFreeze([line("a", 1), line("b", 2), line("c", 3)]);
    expect(okLines(removeLine(lines, "b")).map((entry) => entry.variantId)).toEqual(["a", "c"]);
  });

  it("removing the last line gives an empty cart", () => {
    expect(removeLine(deepFreeze([line("a", 1)]), "a")).toEqual({ ok: true, lines: [] });
  });

  it("refuses an unknown variant", () => {
    expect(removeLine(deepFreeze([line("a", 1)]), "b")).toEqual({
      ok: false,
      reason: "line_not_found",
    });
    expect(removeLine([], "a")).toEqual({ ok: false, reason: "line_not_found" });
  });

  it("does not mutate its input and returns a frozen list", () => {
    const lines = deepFreeze([line("a", 1), line("b", 1)]);
    const output = okLines(removeLine(lines, "a"));
    expect(lines).toHaveLength(2);
    expect(Object.isFrozen(output)).toBe(true);
  });
});

describe("mergeCarts", () => {
  it("returns the customer lines unchanged when the guest cart is empty", () => {
    const customer = deepFreeze([line("a", 2, uah(10))]);
    expect(mergeCarts(customer, [])).toEqual({ lines: customer, notices: [] });
  });

  it("returns the guest lines when the customer cart is empty, with their seen prices", () => {
    const guest = deepFreeze([line("a", 2, uah(10)), line("b", 1)]);
    expect(mergeCarts([], guest)).toEqual({ lines: guest, notices: [] });
  });

  it("adds up quantities of one variant, one line per variant, customer order first", () => {
    const customer = deepFreeze([line("a", 2), line("b", 3)]);
    const guest = deepFreeze([line("c", 1), line("b", 4), line("a", 1)]);
    const merged = mergeCarts(customer, guest);
    expect(merged.lines.map((entry) => [entry.variantId, entry.quantity])).toEqual([
      ["a", 3],
      ["b", 7],
      ["c", 1],
    ]);
    expect(merged.notices).toEqual([]);
  });

  it("takes the guest seen price for a new line and the older customer one for a shared line", () => {
    const customer = deepFreeze([line("a", 1, uah(100)), line("n", 1, null)]);
    const guest = deepFreeze([line("a", 1, uah(150)), line("b", 1, uah(70)), line("n", 1, uah(9))]);
    const merged = mergeCarts(customer, guest);
    const seenOf = (id: string) => merged.lines.find((entry) => entry.variantId === id)?.seen;
    expect(seenOf("a")).toEqual(uah(100));
    expect(seenOf("b")).toEqual(uah(70));
    expect(seenOf("n")).toEqual(uah(9));
  });

  it("caps a sum above 999 at 999 with a quantity_capped notice", () => {
    const customer = deepFreeze([line("a", 990)]);
    const guest = deepFreeze([line("a", 10), line("b", 2)]);
    const merged = mergeCarts(customer, guest);
    expect(merged.lines.map((entry) => [entry.variantId, entry.quantity])).toEqual([
      ["a", 999],
      ["b", 2],
    ]);
    expect(merged.notices).toEqual([{ code: "quantity_capped" }]);
  });

  it("does not warn when the sum is exactly 999", () => {
    const merged = mergeCarts(deepFreeze([line("a", 900)]), deepFreeze([line("a", 99)]));
    expect(merged.lines[0]?.quantity).toBe(999);
    expect(merged.notices).toEqual([]);
  });

  it("gives one quantity_capped notice however many lines were capped", () => {
    const merged = mergeCarts(
      deepFreeze([line("a", 999), line("b", 999)]),
      deepFreeze([line("a", 999), line("b", 1)]),
    );
    expect(merged.lines.map((entry) => entry.quantity)).toEqual([999, 999]);
    expect(merged.notices).toEqual([{ code: "quantity_capped" }]);
  });

  it("drops the guest lines beyond 100 with a lines_dropped notice, keeping merges into existing lines", () => {
    const customer = deepFreeze(manyLines(98));
    const guest = deepFreeze([
      line("variant-3", 4),
      line("extra-1", 1),
      line("extra-2", 1),
      line("extra-3", 1),
      line("variant-4", 1),
    ]);
    const merged = mergeCarts(customer, guest);
    expect(merged.lines).toHaveLength(MAX_CART_LINES);
    expect(merged.lines[3]?.quantity).toBe(5);
    expect(merged.lines[4]?.quantity).toBe(2);
    expect(merged.lines.slice(98).map((entry) => entry.variantId)).toEqual(["extra-1", "extra-2"]);
    expect(merged.notices).toEqual([{ code: "lines_dropped" }]);
  });

  it("reports both notices in a fixed order", () => {
    const merged = mergeCarts(
      deepFreeze([...manyLines(99), line("hot", 999)]),
      deepFreeze([line("hot", 1), line("overflow", 1)]),
    );
    expect(merged.lines).toHaveLength(MAX_CART_LINES);
    expect(merged.notices).toEqual([{ code: "quantity_capped" }, { code: "lines_dropped" }]);
  });

  it("does not mutate its inputs and returns frozen data", () => {
    const customer = deepFreeze([line("a", 1)]);
    const guest = deepFreeze([line("a", 1), line("b", 1)]);
    const merged = mergeCarts(customer, guest);
    expect(customer).toEqual([{ variantId: "a", quantity: 1, seen: null }]);
    expect(guest).toHaveLength(2);
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.lines)).toBe(true);
    expect(Object.isFrozen(merged.notices)).toBe(true);
    for (const entry of merged.lines) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it("treats corrupt carts as bugs (RangeError): duplicate variants, bad quantities, too many lines", () => {
    expect(() => mergeCarts([line("a", 1), line("a", 1)], [])).toThrow(RangeError);
    expect(() => mergeCarts([], [line("a", 1), line("a", 1)])).toThrow(RangeError);
    expect(() => mergeCarts([line("a", 0)], [])).toThrow(RangeError);
    expect(() => mergeCarts([], [line("a", 1000)])).toThrow(RangeError);
    expect(() => mergeCarts(manyLines(MAX_CART_LINES + 1), [])).toThrow(RangeError);
    expect(() => mergeCarts([], manyLines(MAX_CART_LINES + 1))).toThrow(RangeError);
  });
});
