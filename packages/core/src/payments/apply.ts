import type { Money } from "../pricing/money.js";
import { isProviderPaymentFact } from "./fact.js";
import { assertDate } from "./guards.js";
import type { ProviderPaymentFact, ProviderPaymentStatus } from "./provider-port.js";
import type { PaymentAttentionCode } from "./reasons.js";
import { remainingRefundable, type RefundRecord } from "./refund.js";
import { decidePaymentTransition, isLivePaymentStatus, type PaymentStatus } from "./status.js";

/*
 * Applying a bound provider fact to an attempt (ADR 0032 decision 7, core `normalizeProviderFact`): ordering by the
 * provider's `modifiedAt` (M10: no ordering guarantee, the greater `modifiedDate` is current) and the mapping of provider
 * statuses to attempt statuses through the transition table. Call `bindFact` first; a fact that does not bind is never
 * passed here. Pure: the API journals every fact (`applied` = `kind === "apply"`) and writes what this decides.
 */

/** The attempt as stored, under its row lock. */
export interface FactTarget {
  readonly status: PaymentStatus;
  /** `payment.provider_modified_at`: the time of the last applied fact, `null` before the first one. */
  readonly providerModifiedAt: Date | null;
  readonly amount: Money;
  /** Every stored refund of the attempt (to tell our own full refund from a reversal made elsewhere). */
  readonly refunds: readonly RefundRecord[];
}

export type FactDecision =
  /** Older than the last applied fact: journaled `applied = false`, nothing changes. */
  | { readonly kind: "stale" }
  /** Not older, but the transition table refuses it: journaled `applied = false`, nothing changes. */
  | {
      readonly kind: "refused";
      readonly attentionCode: Extract<PaymentAttentionCode, "unexpected_provider_status"> | null;
    }
  /**
   * Applied: `provider_status`, `provider_modified_at`, `final_amount`, card and refunds are recorded; `toStatus` is the
   * new attempt status (`null`: unchanged). `markPaid`: call `markPaidIn` in the same transaction (only on entering
   * `succeeded`) and store `decideOrderOutcome`.
   */
  | {
      readonly kind: "apply";
      readonly toStatus: PaymentStatus | null;
      readonly markPaid: boolean;
      readonly attentionCode: PaymentAttentionCode | null;
    };

const STATUS_TARGETS: Readonly<
  Record<Exclude<ProviderPaymentStatus, "created" | "authorized" | "reversed">, PaymentStatus>
> = Object.freeze({
  processing: "processing",
  succeeded: "succeeded",
  failed: "failed",
  expired: "expired",
});

/** Statuses on which a provider's `created` is simply the current state (no change). */
const WAITING: readonly PaymentStatus[] = ["creating", "awaiting_customer", "create_unknown"];

function apply(
  toStatus: PaymentStatus | null,
  attentionCode: PaymentAttentionCode | null,
): FactDecision {
  return Object.freeze({
    kind: "apply" as const,
    toStatus,
    markPaid: toStatus === "succeeded",
    attentionCode,
  });
}

function refused(current: PaymentStatus): FactDecision {
  // Anything newer that contradicts a success needs an admin; a closed attempt simply stays closed.
  return Object.freeze({
    kind: "refused" as const,
    attentionCode: current === "succeeded" ? ("unexpected_provider_status" as const) : null,
  });
}

/**
 * - Older than `providerModifiedAt`: `stale`. Equal (ADR 0032 open question 5, decided here): the same rules as a newer
 *   fact; the transition table never moves back, so a tie can only move forward or change nothing.
 * - `null` (a status the plugin does not know): unchanged, attention `unknown_provider_status`.
 * - `authorized` (no v1 flow produces it): unchanged, attention `unexpected_provider_status`.
 * - `created`: unchanged on `creating`, `awaiting_customer`, `create_unknown`; refused on anything later.
 * - `processing`, `succeeded`, `failed`, `expired`: the same attempt status (unchanged when it already is), else the
 *   transition table with the `provider` actor. A success on a closed attempt is recorded and marks paid (the outcome
 *   table then refunds it when the order cannot take it).
 * - `reversed` (open question 6, decided here): on `succeeded`, unchanged, attention `external_reversal` unless our own
 *   active refunds already cover the whole amount; on a live attempt, `failed` with attention (money moved and came back,
 *   the order was never paid by it); on a closed attempt, unchanged with attention.
 * A malformed fact or target is a bug (RangeError).
 */
export function normalizeProviderFact(fact: ProviderPaymentFact, target: FactTarget): FactDecision {
  if (!isProviderPaymentFact(fact)) {
    throw new RangeError("normalizeProviderFact needs a well-formed provider fact");
  }
  const current = target.status;
  const live = isLivePaymentStatus(current);
  if (target.providerModifiedAt !== null) {
    assertDate(target.providerModifiedAt, "providerModifiedAt");
    if (fact.modifiedAt.getTime() < target.providerModifiedAt.getTime()) {
      return Object.freeze({ kind: "stale" as const });
    }
  }
  switch (fact.status) {
    case null:
      return apply(null, "unknown_provider_status");
    case "authorized":
      return apply(null, "unexpected_provider_status");
    case "created":
      return WAITING.includes(current) ? apply(null, null) : refused(current);
    case "reversed": {
      if (current === "succeeded") {
        const ours = remainingRefundable(target.amount, target.refunds).amount === 0;
        return apply(null, ours ? null : "external_reversal");
      }
      return apply(live ? "failed" : null, "external_reversal");
    }
    default: {
      const to = STATUS_TARGETS[fact.status];
      if (to === current) {
        return apply(null, null);
      }
      return decidePaymentTransition(current, to, "provider").ok
        ? apply(to, null)
        : refused(current);
    }
  }
}
