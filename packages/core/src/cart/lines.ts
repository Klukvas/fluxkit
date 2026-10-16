import { createMoney } from "../pricing/money.js";
import type { Money } from "../pricing/money.js";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "./limits.js";

/*
 * Cart line rules (plan 2026-10-17, Cart). A cart is a list of lines, one per variant, never more than
 * `MAX_CART_LINES`, each with a quantity from 1 to `MAX_LINE_QUANTITY`. Bad caller input (a quantity from a request) is a
 * typed refusal; a stored cart that breaks these rules (duplicate variants, quantity 0, 101 lines) is corrupt data and
 * throws a RangeError, as the money and stock modules do. Nothing here reads the clock or a database, mutates its
 * arguments, or caps a quantity the shopper typed: only a merge caps, because the shopper did not type the sum.
 */

export interface CartLine {
  readonly variantId: string;
  readonly quantity: number;
  /** The unit price the shopper last saw, or `null` when none was recorded. */
  readonly seen: Money | null;
}

export type CartNoticeCode = "quantity_capped" | "lines_dropped";

export interface CartNotice {
  readonly code: CartNoticeCode;
}

export type LineRefusal =
  "invalid_quantity" | "quantity_limit" | "too_many_lines" | "line_not_found";

export type CartLinesResult =
  | { readonly ok: true; readonly lines: readonly CartLine[] }
  | { readonly ok: false; readonly reason: LineRefusal };

export interface MergedCart {
  readonly lines: readonly CartLine[];
  readonly notices: readonly CartNotice[];
}

function isLineQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** `seen` is a unit price: valid money that is not negative. Anything else is a bug in the caller. */
function freezeSeen(seen: Money | null, where: string): Money | null {
  if (seen === null) {
    return null;
  }
  const money = typeof seen === "object" ? createMoney(seen.amount, seen.currency) : null;
  if (money === null || !money.ok || money.money.amount < 0) {
    throw new RangeError(`${where}: a seen price must be valid, non-negative money or null`);
  }
  return money.money;
}

function buildLine(variantId: string, quantity: number, seen: Money | null): CartLine {
  return Object.freeze({ variantId, quantity, seen });
}

function assertVariantId(variantId: unknown): asserts variantId is string {
  if (typeof variantId !== "string" || variantId.length === 0) {
    throw new RangeError("A cart line needs a non-empty variant id");
  }
}

/** Copies a stored cart into frozen lines and throws for data the rules can never produce. */
function checkedLines(lines: readonly CartLine[], name: string): CartLine[] {
  if (lines.length > MAX_CART_LINES) {
    throw new RangeError(`${name} has more than ${String(MAX_CART_LINES)} lines`);
  }
  const seenVariants = new Set<string>();
  return lines.map((entry) => {
    assertVariantId(entry.variantId);
    if (seenVariants.has(entry.variantId)) {
      throw new RangeError(`${name} has two lines for one variant`);
    }
    seenVariants.add(entry.variantId);
    if (!isLineQuantity(entry.quantity) || entry.quantity > MAX_LINE_QUANTITY) {
      throw new RangeError(`${name} has a line quantity outside 1 to ${String(MAX_LINE_QUANTITY)}`);
    }
    return buildLine(entry.variantId, entry.quantity, freezeSeen(entry.seen, name));
  });
}

function done(lines: CartLine[]): CartLinesResult {
  return { ok: true, lines: Object.freeze(lines) };
}

/** `null` when the quantity is fine for one line, otherwise the refusal. */
function quantityRefusal(quantity: unknown): "invalid_quantity" | "quantity_limit" | null {
  if (!isLineQuantity(quantity)) {
    return "invalid_quantity";
  }
  return quantity > MAX_LINE_QUANTITY ? "quantity_limit" : null;
}

/**
 * Adds a variant, or adds to the quantity of its line (the line keeps its place). A new line goes last. A sum above
 * `MAX_LINE_QUANTITY` is refused (`quantity_limit`), never capped; a 101st line is `too_many_lines`. `seen` is the unit
 * price the shopper sees now: it replaces the stored one, and `null` keeps the stored one.
 */
export function addLine(
  lines: readonly CartLine[],
  variantId: string,
  quantity: number,
  seen: Money | null = null,
): CartLinesResult {
  assertVariantId(variantId);
  const current = checkedLines(lines, "cart");
  const newSeen = freezeSeen(seen, "addLine");
  const refusal = quantityRefusal(quantity);
  if (refusal !== null) {
    return { ok: false, reason: refusal };
  }
  const index = current.findIndex((entry) => entry.variantId === variantId);
  const existing = current[index];
  if (existing === undefined) {
    if (current.length >= MAX_CART_LINES) {
      return { ok: false, reason: "too_many_lines" };
    }
    return done([...current, buildLine(variantId, quantity, newSeen)]);
  }
  const total = existing.quantity + quantity;
  if (total > MAX_LINE_QUANTITY) {
    return { ok: false, reason: "quantity_limit" };
  }
  return done(
    current.map((entry, position) =>
      position === index ? buildLine(variantId, total, newSeen ?? entry.seen) : entry,
    ),
  );
}

/** Sets the quantity of an existing line (1 to `MAX_LINE_QUANTITY`); `seen` as in `addLine`. */
export function setLineQuantity(
  lines: readonly CartLine[],
  variantId: string,
  quantity: number,
  seen: Money | null = null,
): CartLinesResult {
  assertVariantId(variantId);
  const current = checkedLines(lines, "cart");
  const newSeen = freezeSeen(seen, "setLineQuantity");
  const refusal = quantityRefusal(quantity);
  if (refusal !== null) {
    return { ok: false, reason: refusal };
  }
  if (!current.some((entry) => entry.variantId === variantId)) {
    return { ok: false, reason: "line_not_found" };
  }
  return done(
    current.map((entry) =>
      entry.variantId === variantId ? buildLine(variantId, quantity, newSeen ?? entry.seen) : entry,
    ),
  );
}

export function removeLine(lines: readonly CartLine[], variantId: string): CartLinesResult {
  assertVariantId(variantId);
  const current = checkedLines(lines, "cart");
  if (!current.some((entry) => entry.variantId === variantId)) {
    return { ok: false, reason: "line_not_found" };
  }
  return done(current.filter((entry) => entry.variantId !== variantId));
}

/**
 * Merges a guest cart into a customer's cart at login (plan, Merge at login). Customer lines keep their order and
 * guest-only lines follow in guest order. One line per variant: quantities add up and are capped at
 * `MAX_LINE_QUANTITY` (notice `quantity_capped`); guest-only lines beyond `MAX_CART_LINES` are dropped (notice
 * `lines_dropped`). Lines that merge into an existing line are never dropped. `seen` takes the older customer price,
 * or the guest one when the customer line had none, so a price change still shows.
 */
export function mergeCarts(
  customerLines: readonly CartLine[],
  guestLines: readonly CartLine[],
): MergedCart {
  const customer = checkedLines(customerLines, "customer cart");
  const guest = checkedLines(guestLines, "guest cart");
  const merged = [...customer];
  const positions = new Map(merged.map((entry, position) => [entry.variantId, position]));
  let capped = false;
  let dropped = false;
  for (const entry of guest) {
    const position = positions.get(entry.variantId);
    const existing = position === undefined ? undefined : merged[position];
    if (position !== undefined && existing !== undefined) {
      const sum = existing.quantity + entry.quantity;
      if (sum > MAX_LINE_QUANTITY) {
        capped = true;
      }
      merged[position] = buildLine(
        existing.variantId,
        Math.min(sum, MAX_LINE_QUANTITY),
        existing.seen ?? entry.seen,
      );
    } else if (merged.length >= MAX_CART_LINES) {
      dropped = true;
    } else {
      positions.set(entry.variantId, merged.length);
      merged.push(entry);
    }
  }
  const notices: CartNotice[] = [];
  if (capped) {
    notices.push(Object.freeze({ code: "quantity_capped" as const }));
  }
  if (dropped) {
    notices.push(Object.freeze({ code: "lines_dropped" as const }));
  }
  return Object.freeze({ lines: Object.freeze(merged), notices: Object.freeze(notices) });
}
