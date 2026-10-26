/*
 * The status machines of a payment attempt (`payment.status`) and of a refund (`payment_refund.status`), ADR 0032
 * decisions 5 to 11. The transition tables are data, like `ORDER_TRANSITIONS`; `decidePaymentTransition` and
 * `decideRefundTransition` are the only ways a status changes (the API's `PaymentAttempts` is their only writer). Neither
 * changes the order status: only `markPaidIn` does (decision 7). An unknown status or actor is corrupt data or a bug
 * (RangeError).
 */

export const PAYMENT_STATUSES = Object.freeze([
  /** The row is written, the provider has not answered yet (written BEFORE the provider call). */
  "creating",
  /** The provider created the invoice; the shopper has its page (`redirect_url`). */
  "awaiting_customer",
  /** The provider is processing a payment (3-D Secure, the bank). */
  "processing",
  "succeeded",
  "failed",
  /** The provider says the invoice expired. */
  "expired",
  /** Closed by us (a new attempt, a cancel, a manual mark paid); its invoice is invalidated after commit. */
  "invalidated",
  /** The create call may or may not have created an invoice: never retried (M5); bound by a later fact's reference. */
  "create_unknown",
] as const);

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** At most one of these per order (the partial unique index of decision 5). */
export const LIVE_PAYMENT_STATUSES = Object.freeze([
  "creating",
  "awaiting_customer",
  "processing",
  "create_unknown",
] as const satisfies readonly PaymentStatus[]);

/**
 * `system` is the API's own flows (the create route, the record step, job 11, a shopper's cancel or new attempt);
 * `admin` an admin's cancel or manual mark paid; `provider` a verified provider fact (webhook, status read, resync).
 */
export const PAYMENT_ACTORS = Object.freeze(["system", "admin", "provider"] as const);

export type PaymentActor = (typeof PAYMENT_ACTORS)[number];

export const REFUND_STATUSES = Object.freeze([
  /** Written before the provider call (and the queue of automatic refunds). */
  "requested",
  "processing",
  "succeeded",
  "failed",
  /** The answer was lost: settled only from the provider's refund list, never resent (decision 13). */
  "unknown",
] as const);

export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Refunds that count against the paid amount (decision 5): every one but `failed`. */
export const REFUND_ACTIVE_STATUSES = Object.freeze([
  "requested",
  "processing",
  "succeeded",
  "unknown",
] as const satisfies readonly RefundStatus[]);

export interface StatusTransitionRule<S extends string> {
  /** `null` is the creation of the row. */
  readonly from: S | null;
  readonly to: S;
  readonly actors: readonly PaymentActor[];
}

export type PaymentTransitionRule = StatusTransitionRule<PaymentStatus>;
export type RefundTransitionRule = StatusTransitionRule<RefundStatus>;

function rule<S extends string>(
  from: S | null,
  to: S,
  actors: readonly PaymentActor[],
): StatusTransitionRule<S> {
  return Object.freeze({ from, to, actors: Object.freeze([...actors]) });
}

const SYSTEM: readonly PaymentActor[] = ["system"];
const PROVIDER: readonly PaymentActor[] = ["provider"];
const SYSTEM_OR_PROVIDER: readonly PaymentActor[] = ["system", "provider"];

/**
 * Every allowed attempt transition; everything else is refused.
 * - A fact may arrive before the create answer is recorded (the webhook finds the attempt by reference), so `creating`
 *   takes provider facts too; `creating -> create_unknown` also closes a row a crash left behind.
 * - A provider fact may skip statuses (a payment can succeed between two reads).
 * - `succeeded` is terminal: never back to `processing`; `reversed` is recorded with attention, not as a status.
 * - A closed attempt (`failed`, `expired`, `invalidated`) never becomes live again (the one-live-attempt index), but a
 *   success on it is recorded, so the money is applied or refunded (decision 10: "a success that still lands is refunded").
 * - Only an `awaiting_customer` attempt is invalidated; `processing` and `create_unknown` refuse cancel and mark paid
 *   instead (`decideOrderPaymentGuard`).
 */
export const PAYMENT_TRANSITIONS: readonly PaymentTransitionRule[] = Object.freeze([
  rule<PaymentStatus>(null, "creating", SYSTEM),
  rule<PaymentStatus>("creating", "awaiting_customer", SYSTEM),
  rule<PaymentStatus>("creating", "failed", SYSTEM_OR_PROVIDER),
  rule<PaymentStatus>("creating", "create_unknown", SYSTEM),
  rule<PaymentStatus>("creating", "processing", PROVIDER),
  rule<PaymentStatus>("creating", "succeeded", PROVIDER),
  rule<PaymentStatus>("creating", "expired", PROVIDER),
  rule<PaymentStatus>("create_unknown", "processing", PROVIDER),
  rule<PaymentStatus>("create_unknown", "succeeded", PROVIDER),
  rule<PaymentStatus>("create_unknown", "failed", SYSTEM_OR_PROVIDER),
  rule<PaymentStatus>("create_unknown", "expired", PROVIDER),
  rule<PaymentStatus>("awaiting_customer", "processing", PROVIDER),
  rule<PaymentStatus>("awaiting_customer", "succeeded", PROVIDER),
  rule<PaymentStatus>("awaiting_customer", "failed", PROVIDER),
  rule<PaymentStatus>("awaiting_customer", "expired", PROVIDER),
  rule<PaymentStatus>("awaiting_customer", "invalidated", ["system", "admin"]),
  rule<PaymentStatus>("processing", "succeeded", PROVIDER),
  rule<PaymentStatus>("processing", "failed", PROVIDER),
  rule<PaymentStatus>("processing", "expired", PROVIDER),
  rule<PaymentStatus>("failed", "succeeded", PROVIDER),
  rule<PaymentStatus>("expired", "succeeded", PROVIDER),
  rule<PaymentStatus>("invalidated", "succeeded", PROVIDER),
]);

/**
 * Every allowed refund transition. The system records its own call's answer (`requested` to anything); a provider fact
 * (the refund list by our refund id) settles `processing` and `unknown`, and a `requested` row whose answer a crash lost.
 * An `unknown` refund is never failed by the system (ADR 0032 open question 4): only the provider's report settles it.
 */
export const REFUND_TRANSITIONS: readonly RefundTransitionRule[] = Object.freeze([
  rule<RefundStatus>(null, "requested", ["system", "admin"]),
  rule<RefundStatus>("requested", "processing", SYSTEM_OR_PROVIDER),
  rule<RefundStatus>("requested", "succeeded", SYSTEM_OR_PROVIDER),
  rule<RefundStatus>("requested", "failed", SYSTEM_OR_PROVIDER),
  rule<RefundStatus>("requested", "unknown", SYSTEM),
  rule<RefundStatus>("processing", "succeeded", PROVIDER),
  rule<RefundStatus>("processing", "failed", PROVIDER),
  rule<RefundStatus>("unknown", "processing", PROVIDER),
  rule<RefundStatus>("unknown", "succeeded", PROVIDER),
  rule<RefundStatus>("unknown", "failed", PROVIDER),
]);

export type StatusTransitionDecision<S extends string> =
  | { readonly ok: true; readonly from: S | null; readonly to: S }
  | { readonly ok: false; readonly reason: "invalid_transition" | "not_allowed_for_actor" };

function assertMember<S extends string>(
  list: readonly S[],
  value: unknown,
  name: string,
): asserts value is S {
  if (!list.includes(value as S)) {
    throw new RangeError(`Unknown ${name}: ${String(value)}`);
  }
}

function decide<S extends string>(
  table: readonly StatusTransitionRule<S>[],
  statuses: readonly S[],
  name: string,
  from: S | null,
  to: S,
  actor: PaymentActor,
): StatusTransitionDecision<S> {
  if (from !== null) {
    assertMember(statuses, from, name);
  }
  assertMember(statuses, to, name);
  assertMember(PAYMENT_ACTORS, actor, "payment actor");
  const found = table.find((entry) => entry.from === from && entry.to === to);
  if (found === undefined) {
    return Object.freeze({ ok: false as const, reason: "invalid_transition" as const });
  }
  if (!found.actors.includes(actor)) {
    return Object.freeze({ ok: false as const, reason: "not_allowed_for_actor" as const });
  }
  return Object.freeze({ ok: true as const, from, to });
}

/** `from` is `null` for the creation of the row. A pair outside the table (the same status twice included) is refused. */
export function decidePaymentTransition(
  from: PaymentStatus | null,
  to: PaymentStatus,
  actor: PaymentActor,
): StatusTransitionDecision<PaymentStatus> {
  return decide(PAYMENT_TRANSITIONS, PAYMENT_STATUSES, "payment status", from, to, actor);
}

/** `from` is `null` for the creation of the row. A pair outside the table (the same status twice included) is refused. */
export function decideRefundTransition(
  from: RefundStatus | null,
  to: RefundStatus,
  actor: PaymentActor,
): StatusTransitionDecision<RefundStatus> {
  return decide(REFUND_TRANSITIONS, REFUND_STATUSES, "refund status", from, to, actor);
}

/** Whether the attempt counts as the order's one live attempt. */
export function isLivePaymentStatus(status: PaymentStatus): boolean {
  assertMember(PAYMENT_STATUSES, status, "payment status");
  return (LIVE_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(status);
}

/** No transition leaves a terminal status (only `succeeded`: a closed attempt can still record a late success). */
export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  assertMember(PAYMENT_STATUSES, status, "payment status");
  return !PAYMENT_TRANSITIONS.some((entry) => entry.from === status);
}

/** No transition leaves a terminal refund status (`succeeded`, `failed`). */
export function isTerminalRefundStatus(status: RefundStatus): boolean {
  assertMember(REFUND_STATUSES, status, "refund status");
  return !REFUND_TRANSITIONS.some((entry) => entry.from === status);
}
