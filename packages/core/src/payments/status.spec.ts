import { describe, expect, it } from "vitest";
import {
  decidePaymentTransition,
  decideRefundTransition,
  isLivePaymentStatus,
  isTerminalPaymentStatus,
  isTerminalRefundStatus,
  LIVE_PAYMENT_STATUSES,
  PAYMENT_ACTORS,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  REFUND_ACTIVE_STATUSES,
  REFUND_STATUSES,
  REFUND_TRANSITIONS,
  type PaymentActor,
  type PaymentStatus,
  type RefundStatus,
} from "./status.js";

/**
 * A literal copy of the attempt table (ADR 0032 decisions 5 to 10, fixed in plan step 2). `provider` is a verified
 * provider fact (webhook or status read), `system` the API's own flows (create, record, job 11, a shopper's cancel or
 * new attempt), `admin` an admin's cancel or mark paid.
 */
const EXPECTED_PAYMENT: [PaymentStatus | null, PaymentStatus, PaymentActor[]][] = [
  [null, "creating", ["system"]],
  // The create answer is recorded.
  ["creating", "awaiting_customer", ["system"]],
  ["creating", "failed", ["system", "provider"]],
  ["creating", "create_unknown", ["system"]],
  // A fact can arrive before the create answer is recorded (the webhook finds the attempt by reference).
  ["creating", "processing", ["provider"]],
  ["creating", "succeeded", ["provider"]],
  ["creating", "expired", ["provider"]],
  // A webhook carrying our reference binds a create_unknown attempt; job 11 closes it after its expires_at.
  ["create_unknown", "processing", ["provider"]],
  ["create_unknown", "succeeded", ["provider"]],
  ["create_unknown", "failed", ["system", "provider"]],
  ["create_unknown", "expired", ["provider"]],
  ["awaiting_customer", "processing", ["provider"]],
  ["awaiting_customer", "succeeded", ["provider"]],
  ["awaiting_customer", "failed", ["provider"]],
  ["awaiting_customer", "expired", ["provider"]],
  // A new attempt, a cancel or a manual mark paid closes the open invoice.
  ["awaiting_customer", "invalidated", ["system", "admin"]],
  ["processing", "succeeded", ["provider"]],
  ["processing", "failed", ["provider"]],
  ["processing", "expired", ["provider"]],
  // Money taken on a closed attempt is recorded so that it can be refunded; never back to a live status.
  ["failed", "succeeded", ["provider"]],
  ["expired", "succeeded", ["provider"]],
  ["invalidated", "succeeded", ["provider"]],
];

const EXPECTED_REFUND: [RefundStatus | null, RefundStatus, PaymentActor[]][] = [
  [null, "requested", ["system", "admin"]],
  ["requested", "processing", ["system", "provider"]],
  ["requested", "succeeded", ["system", "provider"]],
  ["requested", "failed", ["system", "provider"]],
  ["requested", "unknown", ["system"]],
  ["processing", "succeeded", ["provider"]],
  ["processing", "failed", ["provider"]],
  // A lost answer is settled only by what the provider reports (its refund list by our refund id), never resent.
  ["unknown", "processing", ["provider"]],
  ["unknown", "succeeded", ["provider"]],
  ["unknown", "failed", ["provider"]],
];

describe("payment attempt statuses", () => {
  it("are the eight of ADR 0032 decision 5, the live ones those of the partial unique index", () => {
    expect([...PAYMENT_STATUSES]).toEqual([
      "creating",
      "awaiting_customer",
      "processing",
      "succeeded",
      "failed",
      "expired",
      "invalidated",
      "create_unknown",
    ]);
    expect([...LIVE_PAYMENT_STATUSES]).toEqual([
      "creating",
      "awaiting_customer",
      "processing",
      "create_unknown",
    ]);
    expect([...PAYMENT_ACTORS]).toEqual(["system", "admin", "provider"]);
  });

  it("the transition table is data equal to the expected table, deeply frozen", () => {
    const actual = PAYMENT_TRANSITIONS.map((rule) => [rule.from, rule.to, [...rule.actors]]);
    expect(actual).toEqual(EXPECTED_PAYMENT);
    expect(Object.isFrozen(PAYMENT_TRANSITIONS)).toBe(true);
    for (const rule of PAYMENT_TRANSITIONS) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule.actors)).toBe(true);
    }
  });

  it("decides the whole start x target x actor matrix", () => {
    for (const from of [null, ...PAYMENT_STATUSES]) {
      for (const to of PAYMENT_STATUSES) {
        for (const actor of PAYMENT_ACTORS) {
          const row = EXPECTED_PAYMENT.find(([f, t]) => f === from && t === to);
          const decision = decidePaymentTransition(from, to, actor);
          const label = `${String(from)} -> ${to} by ${actor}`;
          if (row === undefined) {
            expect(decision, label).toEqual({ ok: false, reason: "invalid_transition" });
          } else if (!row[2].includes(actor)) {
            expect(decision, label).toEqual({ ok: false, reason: "not_allowed_for_actor" });
          } else {
            expect(decision, label).toEqual({ ok: true, from, to });
          }
        }
      }
    }
  });

  it("succeeded never moves back, and a closed attempt never becomes live again", () => {
    for (const to of PAYMENT_STATUSES) {
      expect(decidePaymentTransition("succeeded", to, "provider").ok, to).toBe(false);
    }
    for (const from of ["failed", "expired", "invalidated"] as const) {
      for (const to of LIVE_PAYMENT_STATUSES) {
        expect(decidePaymentTransition(from, to, "provider").ok, `${from} -> ${to}`).toBe(false);
      }
    }
    expect(decidePaymentTransition("processing", "awaiting_customer", "provider")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("an attempt that is processing cannot be invalidated (cancel and mark paid are refused instead)", () => {
    for (const actor of PAYMENT_ACTORS) {
      expect(decidePaymentTransition("processing", "invalidated", actor).ok).toBe(false);
      expect(decidePaymentTransition("create_unknown", "invalidated", actor).ok).toBe(false);
    }
  });

  it("only succeeded is terminal; live statuses are the four of the index", () => {
    for (const status of PAYMENT_STATUSES) {
      expect(isTerminalPaymentStatus(status), status).toBe(status === "succeeded");
      expect(isLivePaymentStatus(status), status).toBe(
        (LIVE_PAYMENT_STATUSES as readonly string[]).includes(status),
      );
    }
  });

  it("throws on an unknown status or actor (corrupt data or a bug)", () => {
    expect(() => decidePaymentTransition("paid" as PaymentStatus, "failed", "system")).toThrow(
      RangeError,
    );
    expect(() => decidePaymentTransition(null, "nope" as PaymentStatus, "system")).toThrow(
      RangeError,
    );
    expect(() => decidePaymentTransition(null, "creating", "guest" as PaymentActor)).toThrow(
      RangeError,
    );
    expect(() => isTerminalPaymentStatus("nope" as PaymentStatus)).toThrow(RangeError);
    expect(() => isLivePaymentStatus("__proto__" as PaymentStatus)).toThrow(RangeError);
  });
});

describe("refund statuses", () => {
  it("are the five of ADR 0032 decision 5; the active ones count against the paid amount", () => {
    expect([...REFUND_STATUSES]).toEqual([
      "requested",
      "processing",
      "succeeded",
      "failed",
      "unknown",
    ]);
    expect([...REFUND_ACTIVE_STATUSES]).toEqual([
      "requested",
      "processing",
      "succeeded",
      "unknown",
    ]);
  });

  it("the transition table is data equal to the expected table, deeply frozen", () => {
    const actual = REFUND_TRANSITIONS.map((rule) => [rule.from, rule.to, [...rule.actors]]);
    expect(actual).toEqual(EXPECTED_REFUND);
    expect(Object.isFrozen(REFUND_TRANSITIONS)).toBe(true);
    for (const rule of REFUND_TRANSITIONS) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule.actors)).toBe(true);
    }
  });

  it("decides the whole start x target x actor matrix", () => {
    for (const from of [null, ...REFUND_STATUSES]) {
      for (const to of REFUND_STATUSES) {
        for (const actor of PAYMENT_ACTORS) {
          const row = EXPECTED_REFUND.find(([f, t]) => f === from && t === to);
          const decision = decideRefundTransition(from, to, actor);
          const label = `${String(from)} -> ${to} by ${actor}`;
          if (row === undefined) {
            expect(decision, label).toEqual({ ok: false, reason: "invalid_transition" });
          } else if (!row[2].includes(actor)) {
            expect(decision, label).toEqual({ ok: false, reason: "not_allowed_for_actor" });
          } else {
            expect(decision, label).toEqual({ ok: true, from, to });
          }
        }
      }
    }
  });

  it("an unknown refund is never failed by the system (only the provider's report settles it)", () => {
    expect(decideRefundTransition("unknown", "failed", "system")).toEqual({
      ok: false,
      reason: "not_allowed_for_actor",
    });
    expect(decideRefundTransition("unknown", "requested", "system")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("succeeded and failed are terminal", () => {
    for (const status of REFUND_STATUSES) {
      expect(isTerminalRefundStatus(status), status).toBe(
        status === "succeeded" || status === "failed",
      );
    }
    expect(() => isTerminalRefundStatus("gone" as RefundStatus)).toThrow(RangeError);
    expect(() => decideRefundTransition(null, "gone" as RefundStatus, "system")).toThrow(
      RangeError,
    );
  });
});
