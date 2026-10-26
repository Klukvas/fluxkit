import { describe, expect, it } from "vitest";
import { buildPaymentLines, type BasketInput, type BasketLineInput } from "./basket.js";
import { uah } from "./test-support.js";

const first: BasketLineInput = {
  title: "Чашка",
  quantity: 2,
  unitPrice: uah(25_000),
  lineTotal: uah(50_000),
  sku: "CUP-1",
};
const second: BasketLineInput = {
  title: "Блюдце",
  quantity: 1,
  unitPrice: uah(70_000),
  lineTotal: uah(70_000),
  sku: "SAU-1",
};
const shipping = { title: "Доставка", amount: uah(5_000), code: "nova_post" };
const input: BasketInput = { lines: [first, second], shipping, amount: uah(125_000) };

describe("buildPaymentLines (the provider's basket, its sum checked equal to the amount)", () => {
  it("copies the lines and adds the shipping line", () => {
    expect(buildPaymentLines(input)).toEqual({
      ok: true,
      lines: [
        { name: "Чашка", quantity: 2, unitAmount: uah(25_000), total: uah(50_000), code: "CUP-1" },
        { name: "Блюдце", quantity: 1, unitAmount: uah(70_000), total: uah(70_000), code: "SAU-1" },
        {
          name: "Доставка",
          quantity: 1,
          unitAmount: uah(5_000),
          total: uah(5_000),
          code: "nova_post",
        },
      ],
    });
  });

  it("leaves out a free shipping line and a missing one", () => {
    const free = buildPaymentLines({
      ...input,
      shipping: { ...shipping, amount: uah(0) },
      amount: uah(120_000),
    });
    expect(free.ok && free.lines.length).toBe(2);
    expect(buildPaymentLines({ ...input, shipping: null, amount: uah(120_000) }).ok).toBe(true);
  });

  it("refuses a basket whose sum differs from the amount by one minor unit (no rounding)", () => {
    for (const amount of [124_999, 125_001]) {
      expect(buildPaymentLines({ ...input, amount: uah(amount) }), String(amount)).toEqual({
        ok: false,
        reason: "sum_mismatch",
      });
    }
  });

  it("refuses a line whose total is not the unit price times the quantity, or another currency", () => {
    expect(
      buildPaymentLines({ ...input, lines: [{ ...first, lineTotal: uah(50_001) }, second] }),
    ).toEqual({ ok: false, reason: "invalid_line" });
    expect(
      buildPaymentLines({
        ...input,
        lines: [
          {
            ...first,
            unitPrice: { amount: 25_000, currency: "USD" },
            lineTotal: { amount: 50_000, currency: "USD" },
          },
          second,
        ],
      }),
    ).toEqual({ ok: false, reason: "currency_mismatch" });
    expect(buildPaymentLines({ ...input, lines: [] })).toEqual({ ok: false, reason: "no_lines" });
  });

  it("refuses a zero or fractional quantity and a negative price", () => {
    for (const line of [
      { ...first, quantity: 0, lineTotal: uah(0) },
      { ...first, quantity: 1.5 },
      { ...first, unitPrice: uah(-1), lineTotal: uah(-2) },
      { ...first, title: "  " },
    ]) {
      expect(buildPaymentLines({ ...input, lines: [line, second] }), JSON.stringify(line)).toEqual({
        ok: false,
        reason: "invalid_line",
      });
    }
  });
});
