import { describe, expect, it } from "vitest";
import type { MarkPaidOutcome } from "../orders/events.js";
import { decideOrderOutcome, PAYMENT_ORDER_OUTCOMES } from "./outcome.js";
import { ORDER_ID } from "./test-support.js";

const refused = (reason: string) => ({ ok: false, reason }) as MarkPaidOutcome;

describe("decideOrderOutcome (ADR 0032 decision 7, the outcome table)", () => {
  it("has the stored outcomes of decision 5", () => {
    expect([...PAYMENT_ORDER_OUTCOMES]).toEqual([
      "applied",
      "already_paid",
      "order_not_payable",
      "amount_mismatch",
      "reference_conflict",
    ]);
  });

  it("ok: applied, nothing else", () => {
    expect(decideOrderOutcome({ ok: true, orderId: ORDER_ID, alreadyPaid: false })).toEqual({
      orderOutcome: "applied",
      attentionCode: null,
      automaticRefund: null,
    });
  });

  it("ok alreadyPaid (same reference): already_paid, nothing else", () => {
    expect(decideOrderOutcome({ ok: true, orderId: ORDER_ID, alreadyPaid: true })).toEqual({
      orderOutcome: "already_paid",
      attentionCode: null,
      automaticRefund: null,
    });
  });

  it("order_not_payable (expired, cancelled, reservation gone): attention and a full automatic refund", () => {
    expect(decideOrderOutcome(refused("order_not_payable"))).toEqual({
      orderOutcome: "order_not_payable",
      attentionCode: "late_payment",
      automaticRefund: "late_payment",
    });
  });

  it("payment_reference_conflict (paid by another attempt or by hand): attention and a full automatic refund", () => {
    expect(decideOrderOutcome(refused("payment_reference_conflict"))).toEqual({
      orderOutcome: "reference_conflict",
      attentionCode: "duplicate_payment",
      automaticRefund: "duplicate_payment",
    });
  });

  it("amount_mismatch: attention, NO automatic refund (an admin decides)", () => {
    expect(decideOrderOutcome(refused("amount_mismatch"))).toEqual({
      orderOutcome: "amount_mismatch",
      attentionCode: "amount_mismatch",
      automaticRefund: null,
    });
  });

  it("an answer outside the table is a bug (the attempt's order exists; markPaidIn refuses only as the table says)", () => {
    expect(() => decideOrderOutcome(refused("order_not_found"))).toThrow(RangeError);
    expect(() => decideOrderOutcome(refused("invalid_transition"))).toThrow(RangeError);
    expect(() => decideOrderOutcome(refused("whatever"))).toThrow(RangeError);
    expect(() => decideOrderOutcome(null as unknown as MarkPaidOutcome)).toThrow(RangeError);
  });

  it("answers frozen values", () => {
    expect(Object.isFrozen(decideOrderOutcome(refused("order_not_payable")))).toBe(true);
  });
});
