import { CODE_PATTERN } from "../catalog/limits.js";
import { addMoney, createMoney } from "../pricing/money.js";
import type { Money } from "../pricing/money.js";

/*
 * Order totals (plan 2026-10-17, Order totals; ADR 0011). `total = subtotal + the adjustments that are not included in
 * the price`. Shipping, discount and tax are adjustment lines; core knows those three kinds and their sign, a plugin may
 * add kinds with any sign. Every sum goes through the money module (exact integers, range-checked), so an amount that does
 * not fit is a typed refusal and never a clamp. No clock, no I/O, inputs are not mutated, outputs are frozen.
 *
 * Range rule for the adjustments: the sum of each kind (shipping, discount, tax, counting adjustments that are included
 * in the price too) must fit, and so must the sum of all positive and the sum of all negative adjustments that are
 * not included. Each of those sums only moves in one direction, so "fits" is exact; the subtotal plus the net of both
 * then decides `total_out_of_range` and `negative_total`.
 */

export interface TotalsLine {
  readonly lineTotal: Money;
}

export interface TotalsAdjustment {
  /** `shipping`, `discount`, `tax` or a plugin kind: a lower-case code, as `CODE_PATTERN`. */
  readonly kind: string;
  /** Signed: a discount is negative. */
  readonly amount: Money;
  /** Reported in its kind total but not added to the order total (tax or shipping already inside the prices). */
  readonly includedInPrice: boolean;
}

export interface OrderTotals {
  readonly subtotal: Money;
  /** Sum of all `shipping` adjustments, included ones too. */
  readonly shippingTotal: Money;
  /** Sum of all `discount` adjustments (zero or negative), included ones too. */
  readonly discountTotal: Money;
  /** Sum of all `tax` adjustments, included ones too. */
  readonly taxTotal: Money;
  readonly total: Money;
}

export type TotalsRefusal =
  | "no_lines"
  | "currency_mismatch"
  | "subtotal_out_of_range"
  | "adjustments_out_of_range"
  | "total_out_of_range"
  | "negative_total";

export type TotalsResult =
  | { readonly ok: true; readonly totals: OrderTotals }
  | { readonly ok: false; readonly reason: TotalsRefusal }
  | {
      readonly ok: false;
      readonly reason: "invalid_adjustment";
      /** Position of the first adjustment with a bad kind or a sign its kind does not allow. */
      readonly index: number;
    };

function validMoney(value: unknown, what: string): Money {
  const candidate = value as { amount?: unknown; currency?: unknown } | null | undefined;
  const created =
    typeof candidate === "object" && candidate !== null
      ? createMoney(candidate.amount, candidate.currency)
      : null;
  if (created === null || !created.ok) {
    throw new RangeError(`${what} must be valid money`);
  }
  return created.money;
}

interface CheckedAdjustment {
  readonly kind: string;
  readonly amount: Money;
  readonly includedInPrice: boolean;
}

function signAllowed(kind: string, amount: number): boolean {
  switch (kind) {
    case "discount":
      return amount <= 0;
    case "shipping":
    case "tax":
      return amount >= 0;
    default:
      return true;
  }
}

/** Adds in order; `null` when a partial sum leaves the range (callers only pass same-sign values, so that is exact). */
function sum(start: Money, values: readonly Money[]): Money | null {
  let current = start;
  for (const value of values) {
    const next = addMoney(current, value);
    if (!next.ok) {
      if (next.reason !== "amount_out_of_range") {
        throw new RangeError(`Unexpected money failure: ${next.reason}`);
      }
      return null;
    }
    current = next.money;
  }
  return current;
}

export function computeOrderTotals(
  lines: readonly TotalsLine[],
  adjustments: readonly TotalsAdjustment[],
): TotalsResult {
  const firstLine = lines[0];
  if (firstLine === undefined) {
    return { ok: false, reason: "no_lines" };
  }
  const lineTotals = lines.map((line) => {
    const lineTotal = validMoney(line.lineTotal, "A line total");
    if (lineTotal.amount < 0) {
      throw new RangeError("A line total must not be negative");
    }
    return lineTotal;
  });
  const checked: CheckedAdjustment[] = adjustments.map((entry) => {
    if (typeof entry.kind !== "string" || typeof entry.includedInPrice !== "boolean") {
      throw new RangeError(
        "An adjustment needs a kind (text) and an includedInPrice flag (boolean)",
      );
    }
    return {
      kind: entry.kind,
      amount: validMoney(entry.amount, "An adjustment amount"),
      includedInPrice: entry.includedInPrice,
    };
  });

  const currency = lineTotals[0]?.currency ?? firstLine.lineTotal.currency;
  if (
    lineTotals.some((lineTotal) => lineTotal.currency !== currency) ||
    checked.some((entry) => entry.amount.currency !== currency)
  ) {
    return { ok: false, reason: "currency_mismatch" };
  }
  const invalid = checked.findIndex(
    (entry) => !CODE_PATTERN.test(entry.kind) || !signAllowed(entry.kind, entry.amount.amount),
  );
  if (invalid !== -1) {
    return { ok: false, reason: "invalid_adjustment", index: invalid };
  }

  const zeroResult = createMoney(0, currency);
  if (!zeroResult.ok) {
    throw new RangeError("Unsupported order currency");
  }
  const zero = zeroResult.money;
  const subtotal = sum(zero, lineTotals);
  if (subtotal === null) {
    return { ok: false, reason: "subtotal_out_of_range" };
  }

  const ofKind = (kind: string): Money[] =>
    checked.filter((entry) => entry.kind === kind).map((entry) => entry.amount);
  const payable = checked.filter((entry) => !entry.includedInPrice).map((entry) => entry.amount);
  const shippingTotal = sum(zero, ofKind("shipping"));
  const discountTotal = sum(zero, ofKind("discount"));
  const taxTotal = sum(zero, ofKind("tax"));
  const added = sum(
    zero,
    payable.filter((amount) => amount.amount > 0),
  );
  const subtracted = sum(
    zero,
    payable.filter((amount) => amount.amount < 0),
  );
  if (
    shippingTotal === null ||
    discountTotal === null ||
    taxTotal === null ||
    added === null ||
    subtracted === null
  ) {
    return { ok: false, reason: "adjustments_out_of_range" };
  }

  const net = addMoney(added, subtracted);
  if (!net.ok) {
    throw new RangeError(`Unexpected money failure: ${net.reason}`);
  }
  const total = addMoney(subtotal, net.money);
  if (!total.ok) {
    if (total.reason !== "amount_out_of_range") {
      throw new RangeError(`Unexpected money failure: ${total.reason}`);
    }
    return { ok: false, reason: "total_out_of_range" };
  }
  if (total.money.amount < 0) {
    return { ok: false, reason: "negative_total" };
  }
  return {
    ok: true,
    totals: Object.freeze({
      subtotal,
      shippingTotal,
      discountTotal,
      taxTotal,
      total: total.money,
    }),
  };
}
