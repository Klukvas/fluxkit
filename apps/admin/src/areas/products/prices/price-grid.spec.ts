import type { AdminPrice, ProblemDetails } from "@fluxkit/api-client";
import { CURRENCIES, validatePrice } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  MAX_BULK_PRICE_ITEMS,
  addColumn,
  canRemoveColumn,
  cellKey,
  fieldName,
  gridFrom,
  planPriceSave,
  priceDeleteBlock,
  priceErrorsFromProblem,
  priceGridDirty,
  pricesRevision,
  removeColumn,
  setCell,
  type PriceGridContext,
} from "./price-grid";

const stamp = "2026-10-20T10:00:00.000Z";

const context: PriceGridContext = {
  shopCurrency: "UAH",
  currencies: Object.entries(CURRENCIES).map(([code, exponent]) => ({ code, exponent })),
  variantIds: ["v1", "v2", "v3"],
};

function price(
  variantId: string,
  currency: string,
  amount: number,
  compareAt: number | null = null,
): AdminPrice {
  return {
    id: `p-${variantId}-${currency}`,
    variantId,
    currency,
    amount,
    compareAtAmount: compareAt,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

const stored = [
  price("v1", "UAH", 123456, 150000),
  price("v1", "JPY", 1500),
  price("v2", "UAH", 5),
];

describe("gridFrom", () => {
  it("puts the shop currency first, then the stored currencies in the config's order", () => {
    const grid = gridFrom([price("v1", "KWD", 1), price("v2", "EUR", 1)], context);
    expect(grid.columns).toEqual(["UAH", "EUR", "KWD"]);
  });

  it("shows the shop currency even when no variant has a price yet", () => {
    expect(gridFrom([], context).columns).toEqual(["UAH"]);
  });

  it("writes each stored amount as exact decimal text with its currency's exponent", () => {
    const grid = gridFrom(stored, context);
    expect(grid.cells[cellKey("v1", "UAH")]).toEqual({ amount: "1234.56", compareAt: "1500.00" });
    expect(grid.cells[cellKey("v1", "JPY")]).toEqual({ amount: "1500", compareAt: "" });
    expect(grid.cells[cellKey("v2", "UAH")]).toEqual({ amount: "0.05", compareAt: "" });
    expect(grid.cells[cellKey("v3", "UAH")]).toBeUndefined();
  });

  it("refuses a stored currency the config does not list (the two answers of the API disagree: a bug)", () => {
    expect(() => gridFrom([price("v1", "XXX", 1)], context)).toThrow(RangeError);
  });
});

describe("columns", () => {
  it("adds a supported currency once, keeping the config's order after the shop currency", () => {
    let grid = gridFrom(stored, context);
    grid = addColumn(grid, "EUR", context);
    grid = addColumn(grid, "EUR", context);
    grid = addColumn(grid, "CAD", context);
    expect(grid.columns).toEqual(["UAH", "EUR", "CAD", "JPY"]);
  });

  it("refuses to add a currency the config does not support", () => {
    const grid = gridFrom(stored, context);
    expect(() => addColumn(grid, "uah", context)).toThrow(RangeError);
    expect(() => addColumn(grid, "XXX", context)).toThrow(RangeError);
  });

  it("hides only an added column that holds no stored price and no typed text; never the shop currency", () => {
    let grid = addColumn(gridFrom(stored, context), "EUR", context);
    expect(canRemoveColumn(grid, "UAH", stored)).toBe(false);
    expect(canRemoveColumn(grid, "JPY", stored)).toBe(false);
    expect(canRemoveColumn(grid, "EUR", stored)).toBe(true);
    grid = setCell(grid, "v2", "EUR", "amount", "1");
    expect(canRemoveColumn(grid, "EUR", stored)).toBe(false);
    grid = setCell(grid, "v2", "EUR", "amount", "");
    expect(removeColumn(grid, "EUR", stored).columns).toEqual(["UAH", "JPY"]);
    expect(removeColumn(grid, "JPY", stored).columns).toEqual(["UAH", "EUR", "JPY"]);
  });
});

describe("priceGridDirty", () => {
  it("is false for the stored grid and for an added empty column, true for any typed change", () => {
    const initial = gridFrom(stored, context);
    expect(priceGridDirty(initial, initial)).toBe(false);
    expect(priceGridDirty(addColumn(initial, "EUR", context), initial)).toBe(false);
    expect(priceGridDirty(setCell(initial, "v3", "UAH", "amount", "1"), initial)).toBe(true);
    expect(priceGridDirty(setCell(initial, "v1", "UAH", "compareAt", ""), initial)).toBe(true);
  });
});

describe("planPriceSave: the bulk body holds only new and changed prices", () => {
  it("sends nothing when nothing changed (and says so)", () => {
    const grid = gridFrom(stored, context);
    expect(planPriceSave(grid, stored, context)).toEqual({ ok: true, items: [] });
  });

  it("treats the same amount in another spelling as unchanged (compared as integers, never as text)", () => {
    let grid = gridFrom(stored, context);
    grid = setCell(grid, "v1", "UAH", "amount", "001234.56");
    grid = setCell(grid, "v2", "UAH", "amount", " 0.05 ");
    grid = setCell(grid, "v1", "UAH", "compareAt", "1500");
    expect(planPriceSave(grid, stored, context)).toEqual({ ok: true, items: [] });
  });

  it("sends a new cell and a changed cell with integer minor units and an explicit compare-at", () => {
    let grid = addColumn(gridFrom(stored, context), "KWD", context);
    grid = setCell(grid, "v3", "UAH", "amount", "99.90");
    grid = setCell(grid, "v1", "JPY", "amount", "1600");
    grid = setCell(grid, "v2", "KWD", "amount", "1.234");
    grid = setCell(grid, "v2", "KWD", "compareAt", "2");
    const plan = planPriceSave(grid, stored, context);
    expect(plan).toEqual({
      ok: true,
      items: [
        {
          key: cellKey("v1", "JPY"),
          item: { variantId: "v1", currency: "JPY", amount: 1600, compareAtAmount: null },
        },
        {
          key: cellKey("v2", "KWD"),
          item: { variantId: "v2", currency: "KWD", amount: 1234, compareAtAmount: 2000 },
        },
        {
          key: cellKey("v3", "UAH"),
          item: { variantId: "v3", currency: "UAH", amount: 9990, compareAtAmount: null },
        },
      ],
    });
  });

  it("clears a compare-at price by sending null, and keeps the amount", () => {
    const grid = setCell(gridFrom(stored, context), "v1", "UAH", "compareAt", "");
    expect(planPriceSave(grid, stored, context)).toEqual({
      ok: true,
      items: [
        {
          key: cellKey("v1", "UAH"),
          item: { variantId: "v1", currency: "UAH", amount: 123456, compareAtAmount: null },
        },
      ],
    });
  });

  it("accepts zero as a price (the API does)", () => {
    const grid = setCell(gridFrom(stored, context), "v3", "UAH", "amount", "0");
    const plan = planPriceSave(grid, stored, context);
    expect(plan.ok && plan.items[0]?.item.amount).toBe(0);
  });

  it("refuses every bad cell at once, on its own field, and sends nothing", () => {
    let grid = addColumn(gridFrom(stored, context), "KWD", context);
    grid = setCell(grid, "v3", "UAH", "amount", "12,50");
    grid = setCell(grid, "v1", "JPY", "amount", "1.5");
    grid = setCell(grid, "v2", "KWD", "amount", "-1");
    grid = setCell(grid, "v3", "KWD", "amount", "1 000");
    grid = setCell(grid, "v1", "KWD", "amount", "-0");
    grid = setCell(grid, "v2", "UAH", "amount", "10000000000.01");
    const plan = planPriceSave(grid, stored, context);
    expect(plan).toEqual({
      ok: false,
      issues: {
        [fieldName("v1", "JPY", "amount")]: "too_many_decimals",
        [fieldName("v1", "KWD", "amount")]: "negative_zero",
        [fieldName("v2", "UAH", "amount")]: "amount_out_of_range",
        [fieldName("v2", "KWD", "amount")]: "negative_amount",
        [fieldName("v3", "UAH", "amount")]: "comma_separator",
        [fieldName("v3", "KWD", "amount")]: "inner_space",
      },
    });
  });

  it("needs an amount next to a compare-at price, and a stored price is removed with Remove, not by emptying it", () => {
    let grid = setCell(gridFrom(stored, context), "v3", "UAH", "compareAt", "10");
    grid = setCell(grid, "v2", "UAH", "amount", "");
    expect(planPriceSave(grid, stored, context)).toEqual({
      ok: false,
      issues: {
        [fieldName("v2", "UAH", "amount")]: "stored_needs_amount",
        [fieldName("v3", "UAH", "amount")]: "amount_required",
      },
    });
  });

  it("needs the compare-at price to be strictly higher than the price (the API's rule)", () => {
    for (const [amount, compareAt, ok] of [
      ["10", "10", false],
      ["10", "9.99", false],
      ["10", "10.01", true],
      ["0", "0", false],
      ["0", "0.01", true],
    ] as const) {
      const grid = setCell(
        setCell(gridFrom([], context), "v1", "UAH", "amount", amount),
        "v1",
        "UAH",
        "compareAt",
        compareAt,
      );
      const plan = planPriceSave(grid, [], context);
      expect(plan.ok, `${amount} < ${compareAt}`).toBe(ok);
      if (!plan.ok) {
        expect(plan.issues).toEqual({
          [fieldName("v1", "UAH", "compareAt")]: "compare_at_not_greater",
        });
      }
    }
  });

  it("checks a compare-at text like an amount (decimals, sign, range)", () => {
    const grid = setCell(
      setCell(gridFrom([], context), "v1", "JPY", "amount", "1"),
      "v1",
      "JPY",
      "compareAt",
      "1.5",
    );
    const withJpy = addColumn(grid, "JPY", context);
    expect(planPriceSave(withJpy, [], context)).toEqual({
      ok: false,
      issues: { [fieldName("v1", "JPY", "compareAt")]: "too_many_decimals" },
    });
  });

  it("decides compare-at exactly like core's validatePrice over many pairs", () => {
    const values = [0, 1, 2, 99, 100, 101, 999_999_999_999, 1_000_000_000_000];
    for (const amount of values) {
      for (const compareAt of values) {
        const grid = setCell(
          setCell(gridFrom([], context), "v1", "UAH", "amount", decimal(amount)),
          "v1",
          "UAH",
          "compareAt",
          decimal(compareAt),
        );
        const plan = planPriceSave(grid, [], context);
        const core = validatePrice({ amount, currency: "UAH", compareAtAmount: compareAt });
        expect(plan.ok, `${amount} ${compareAt}`).toBe(core.ok);
      }
    }
  });

  it("keeps one save to one bulk call of at most 500 items (all or nothing)", () => {
    const many: PriceGridContext = {
      ...context,
      variantIds: Array.from({ length: 251 }, (_, index) => `v${index}`),
    };
    let grid = addColumn(gridFrom([], many), "EUR", many);
    for (const variantId of many.variantIds) {
      grid = setCell(grid, variantId, "UAH", "amount", "1");
      grid = setCell(grid, variantId, "EUR", "amount", "1");
    }
    expect(MAX_BULK_PRICE_ITEMS).toBe(500);
    expect(planPriceSave(grid, [], many)).toEqual({
      ok: false,
      issues: { items: "too_many_changes" },
    });
    grid = setCell(grid, "v0", "EUR", "amount", "");
    grid = setCell(grid, "v1", "EUR", "amount", "");
    const plan = planPriceSave(grid, [], many);
    expect(plan.ok && plan.items.length).toBe(500);
  });

  it("ignores cells of variants that are no longer in the product", () => {
    const grid = setCell(gridFrom([], context), "gone", "UAH", "amount", "1");
    expect(planPriceSave(grid, [], context)).toEqual({ ok: true, items: [] });
  });
});

describe("priceErrorsFromProblem", () => {
  const sent = [cellKey("v1", "JPY"), cellKey("v2", "KWD"), cellKey("v3", "UAH")];

  it("puts each indexed error of the bulk call on the cell of that item", () => {
    const problem: ProblemDetails = {
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      code: "validation_failed",
      detail: "x",
      errors: [
        { path: "items.1.compareAtAmount", code: "compare_at_not_greater", message: "x" },
        { path: "items.2.amount", code: "amount_out_of_range", message: "x" },
        { path: "items.0.variantId", code: "invalid_reference", message: "x" },
        { path: "items.0.currency", code: "unsupported_currency", message: "x" },
        { path: "items", code: "too_big", message: "x" },
        { path: "items.9.amount", code: "required", message: "x" },
      ],
    };
    expect(priceErrorsFromProblem(problem, 400, sent)).toEqual({
      fields: {
        [fieldName("v2", "KWD", "compareAt")]: { key: "errors.reason.compare_at_not_greater" },
        [fieldName("v3", "UAH", "amount")]: { key: "errors.reason.amount_out_of_range" },
        [fieldName("v1", "JPY", "amount")]: { key: "errors.reason.invalid_reference" },
      },
      other: [{ key: "errors.reason.too_big" }, { key: "errors.reason.required" }],
    });
  });

  it("explains a problem without errors through the problem map", () => {
    const problem: ProblemDetails = {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "not_found",
      detail: "x",
    };
    expect(priceErrorsFromProblem(problem, 404, sent)).toEqual({
      fields: {},
      other: [{ key: "errors.code.not_found" }],
    });
  });
});

describe("priceDeleteBlock", () => {
  it("says last_shop_price for the shop-currency price of an active variant of a published product, as the API refuses", () => {
    expect(priceDeleteBlock("UAH", "UAH", true, "active")).toBe("last_shop_price");
    expect(priceDeleteBlock("UAH", "UAH", false, "active")).toBeNull();
    expect(priceDeleteBlock("UAH", "UAH", true, "draft")).toBeNull();
    expect(priceDeleteBlock("UAH", "UAH", true, "archived")).toBeNull();
    expect(priceDeleteBlock("EUR", "UAH", true, "active")).toBeNull();
  });
});

describe("pricesRevision", () => {
  it("changes when a stored price changes and stays for the same answer", () => {
    const again = stored.map((entry) => ({ ...entry }));
    expect(pricesRevision(again)).toBe(pricesRevision(stored));
    const changed = stored.map((entry, index) =>
      index === 0 ? { ...entry, updatedAt: "2026-10-20T11:00:00.000Z" } : entry,
    );
    expect(pricesRevision(changed)).not.toBe(pricesRevision(stored));
    expect(pricesRevision(stored.slice(1))).not.toBe(pricesRevision(stored));
  });
});

function decimal(amount: number): string {
  const digits = String(amount).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
