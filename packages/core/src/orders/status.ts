/*
 * The order status machine (plan 2026-10-17, Statuses; ADR 0017). The transition table is data; `decideTransition` is the
 * only way a status changes, and `stockEffectOf` tells the caller what to do with the reservations. ADR 0004 decision 4
 * derives the status from payment and fulfilment entities; v1 keeps one explicit status because neither entity exists
 * yet. No clock, no I/O. Data errors (a transition nobody may make) are typed refusals; an unknown status or actor is
 * corrupt data or a bug and throws a RangeError.
 */

export const ORDER_STATUSES = Object.freeze([
  "awaiting_payment",
  "paid",
  "fulfilled",
  "cancelled",
  "expired",
] as const);

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_ACTORS = Object.freeze(["customer", "guest", "admin", "system"] as const);

export type OrderActor = (typeof ORDER_ACTORS)[number];

/** What a transition does to the stock reservations of the order's lines. */
export type StockEffect = "reserve" | "commit" | "release" | "none";

export interface TransitionRule {
  /** `null` is the creation of the order (checkout). */
  readonly from: OrderStatus | null;
  readonly to: OrderStatus;
  readonly actors: readonly OrderActor[];
  readonly stockEffect: StockEffect;
}

function rule(
  from: OrderStatus | null,
  to: OrderStatus,
  actors: readonly OrderActor[],
  stockEffect: StockEffect,
): TransitionRule {
  return Object.freeze({ from, to, actors: Object.freeze([...actors]), stockEffect });
}

/**
 * Every allowed transition. `system` is the scheduler (expiry) and, later, a payment or shipping plugin acting through a
 * port. A paid order is cancelled by an admin only and its sold units stay sold (no automatic restock).
 * Everything not listed is refused, and `fulfilled`, `cancelled` and `expired` have no way out.
 */
export const ORDER_TRANSITIONS: readonly TransitionRule[] = Object.freeze([
  rule(null, "awaiting_payment", ["customer", "guest"], "reserve"),
  rule("awaiting_payment", "paid", ["admin", "system"], "commit"),
  rule("awaiting_payment", "cancelled", ["customer", "guest", "admin"], "release"),
  rule("awaiting_payment", "expired", ["system"], "release"),
  rule("paid", "fulfilled", ["admin", "system"], "commit"),
  rule("paid", "cancelled", ["admin"], "none"),
]);

export type TransitionRefusal = "invalid_transition" | "not_allowed_for_actor";

export type TransitionDecision =
  | {
      readonly ok: true;
      readonly from: OrderStatus | null;
      readonly to: OrderStatus;
      readonly stockEffect: StockEffect;
    }
  | { readonly ok: false; readonly reason: TransitionRefusal };

function assertStatus(value: unknown): asserts value is OrderStatus {
  if (!ORDER_STATUSES.includes(value as OrderStatus)) {
    throw new RangeError(`Unknown order status: ${String(value)}`);
  }
}

function assertStart(value: unknown): asserts value is OrderStatus | null {
  if (value !== null) {
    assertStatus(value);
  }
}

function assertActor(value: unknown): asserts value is OrderActor {
  if (!ORDER_ACTORS.includes(value as OrderActor)) {
    throw new RangeError(`Unknown order actor: ${String(value)}`);
  }
}

function findRule(from: OrderStatus | null, to: OrderStatus): TransitionRule | undefined {
  return ORDER_TRANSITIONS.find((entry) => entry.from === from && entry.to === to);
}

/** `from` is `null` for the creation of the order. A pair outside the table is `invalid_transition`, whoever asks. */
export function decideTransition(
  from: OrderStatus | null,
  to: OrderStatus,
  actor: OrderActor,
): TransitionDecision {
  assertStart(from);
  assertStatus(to);
  assertActor(actor);
  const found = findRule(from, to);
  if (found === undefined) {
    return Object.freeze({ ok: false as const, reason: "invalid_transition" as const });
  }
  if (!found.actors.includes(actor)) {
    return Object.freeze({ ok: false as const, reason: "not_allowed_for_actor" as const });
  }
  return Object.freeze({ ok: true as const, from, to, stockEffect: found.stockEffect });
}

/** The caller decided the transition first; asking for a pair outside the table is a bug (RangeError). */
export function stockEffectOf(from: OrderStatus | null, to: OrderStatus): StockEffect {
  assertStart(from);
  assertStatus(to);
  const found = findRule(from, to);
  if (found === undefined) {
    throw new RangeError(`No transition from ${String(from)} to ${to}`);
  }
  return found.stockEffect;
}

/** No transition leaves a terminal status. */
export function isTerminalStatus(status: OrderStatus): boolean {
  assertStatus(status);
  return !ORDER_TRANSITIONS.some((entry) => entry.from === status);
}
