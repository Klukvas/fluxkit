import { describe, expect, it } from "vitest";
import { paymentFixture } from "../../test-helpers";
import {
  REFUND_NOTE_MAX_LENGTH,
  isRefundDirty,
  newRefundDraft,
  openRefundDialog,
  planRefund,
  refundDefaults,
  resolveRefundKey,
  type RefundDraft,
} from "./refund-form";

function payment(amount: number, refundable: number, currency = "UAH") {
  return paymentFixture({
    amount: { amount, currency },
    refundableAmount: { amount: refundable, currency },
  });
}

describe("the refund amount the dialog starts with: the remaining refundable amount", () => {
  it("is the whole amount for a payment nothing was refunded from, at the currency's exponent", () => {
    expect(refundDefaults(payment(18900, 18900), 2)).toEqual({ amount: "189.00", note: "" });
    expect(refundDefaults(payment(18900, 18900, "JPY"), 0)).toEqual({ amount: "18900", note: "" });
    expect(refundDefaults(payment(18900, 18900, "KWD"), 3)).toEqual({ amount: "18.900", note: "" });
  });

  it("is what is left after refunds, not the payment amount", () => {
    expect(refundDefaults(payment(18900, 13900), 2).amount).toBe("139.00");
    expect(refundDefaults(payment(18900, 5), 2).amount).toBe("0.05");
    expect(refundDefaults(payment(18900, 1), 3).amount).toBe("0.001");
  });

  it("is zero when nothing can be refunded", () => {
    expect(refundDefaults(payment(18900, 0), 2).amount).toBe("0.00");
  });
});

describe("planning a refund body (integer minor units, no float math)", () => {
  const whole = payment(18900, 18900);

  it("sends the typed decimal as exact minor units in the payment's currency", () => {
    const plan = planRefund({ amount: "50.5", note: " Damaged item " }, whole, 2);
    expect(plan).toEqual({
      ok: true,
      body: { amount: { amount: 5050, currency: "UAH" }, note: "Damaged item" },
    });
  });

  it("reads the amount with exponents 0, 2 and 3", () => {
    const zero = payment(1000, 1000, "JPY");
    expect(planRefund({ amount: "999", note: "n" }, zero, 0)).toMatchObject({
      ok: true,
      body: { amount: { amount: 999, currency: "JPY" } },
    });
    expect(planRefund({ amount: "9.99", note: "n" }, zero, 0)).toMatchObject({
      ok: false,
      issues: { amount: "too_many_decimals" },
    });
    const three = payment(12345, 12345, "KWD");
    expect(planRefund({ amount: "12.345", note: "n" }, three, 3)).toMatchObject({
      ok: true,
      body: { amount: { amount: 12345, currency: "KWD" } },
    });
    expect(planRefund({ amount: "0.1", note: "n" }, whole, 2)).toMatchObject({
      ok: true,
      body: { amount: { amount: 10 } },
    });
  });

  it("is exact where floating point is not", () => {
    const big = payment(900_000_000_000, 900_000_000_000);
    expect(planRefund({ amount: "8999999999.99", note: "n" }, big, 2)).toMatchObject({
      ok: true,
      body: { amount: { amount: 899_999_999_999 } },
    });
    expect(planRefund({ amount: "1.15", note: "n" }, whole, 2)).toMatchObject({
      body: { amount: { amount: 115 } },
    });
  });

  it("allows a partial amount and the full remaining amount, refuses more", () => {
    const left = payment(18900, 13900);
    expect(planRefund({ amount: "139.00", note: "n" }, left, 2).ok).toBe(true);
    expect(planRefund({ amount: "1.00", note: "n" }, left, 2).ok).toBe(true);
    expect(planRefund({ amount: "139.01", note: "n" }, left, 2)).toMatchObject({
      ok: false,
      issues: { amount: "exceeds_remaining" },
    });
  });

  it("refuses zero, negative, comma, spaces, empty and unparsable amounts on the field", () => {
    const issueOf = (amount: string) => {
      const plan = planRefund({ amount, note: "n" }, whole, 2);
      return plan.ok ? null : plan.issues.amount;
    };
    expect(issueOf("0")).toBe("not_positive");
    expect(issueOf("0.00")).toBe("not_positive");
    expect(issueOf("-5")).toBe("negative_amount");
    expect(issueOf("5,5")).toBe("comma_separator");
    expect(issueOf("5 5")).toBe("inner_space");
    expect(issueOf("")).toBe("empty");
    expect(issueOf("abc")).toBe("invalid_format");
    expect(issueOf("1.234")).toBe("too_many_decimals");
  });

  it("refuses when nothing is left to refund", () => {
    expect(planRefund({ amount: "0.01", note: "n" }, payment(18900, 0), 2)).toMatchObject({
      ok: false,
      issues: { amount: "exceeds_remaining" },
    });
  });

  it("needs a note: trimmed, 1 to 500 characters, no control characters", () => {
    const issueOf = (note: string) => {
      const plan = planRefund({ amount: "1.00", note }, whole, 2);
      return plan.ok ? null : plan.issues.note;
    };
    expect(issueOf("")).toBe("required");
    expect(issueOf("   ")).toBe("required");
    expect(issueOf("x".repeat(REFUND_NOTE_MAX_LENGTH + 1))).toBe("too_long");
    expect(issueOf("x".repeat(REFUND_NOTE_MAX_LENGTH))).toBeNull();
    expect(issueOf("a\u0000b")).toBe("invalid_characters");
  });

  it("reports both fields at once", () => {
    const plan = planRefund({ amount: "", note: "" }, whole, 2);
    expect(plan).toEqual({ ok: false, issues: { amount: "empty", note: "required" } });
  });
});

describe("dirty values", () => {
  it("is dirty only when the admin changed the amount or typed a note", () => {
    const defaults = refundDefaults(payment(18900, 18900), 2);
    expect(isRefundDirty(defaults, defaults)).toBe(false);
    expect(isRefundDirty({ ...defaults, note: "x" }, defaults)).toBe(true);
    expect(isRefundDirty({ ...defaults, amount: "1.00" }, defaults)).toBe(true);
  });
});

describe("the Idempotency-Key of a refund", () => {
  function counter() {
    let n = 0;
    return () => `key-${String(++n)}`;
  }
  const bodyA = { amount: { amount: 5000, currency: "UAH" }, note: "Damaged" };

  it("is generated once when the dialog opens", () => {
    const makeKey = counter();
    const draft = newRefundDraft(makeKey);
    expect(draft).toEqual({ key: "key-1", sent: null });
    expect(makeKey()).toBe("key-2");
  });

  it("keeps the first key for the first send of a fresh dialog", () => {
    const makeKey = counter();
    const draft = newRefundDraft(makeKey);
    expect(resolveRefundKey(draft, bodyA, makeKey).key).toBe("key-1");
  });

  it("is reused when the same form is sent again (a lost answer, a refusal, a second click)", () => {
    const makeKey = counter();
    let draft: RefundDraft = newRefundDraft(makeKey);
    draft = resolveRefundKey(draft, bodyA, makeKey);
    const again = resolveRefundKey(draft, { ...bodyA, amount: { ...bodyA.amount } }, makeKey);
    expect(again.key).toBe("key-1");
    expect(makeKey()).toBe("key-2");
  });

  it("is new when the amount or the note changed after a send (else the server answers idempotency_key_reused)", () => {
    const makeKey = counter();
    const first = resolveRefundKey(newRefundDraft(makeKey), bodyA, makeKey);
    const otherAmount = resolveRefundKey(
      first,
      { ...bodyA, amount: { amount: 4000, currency: "UAH" } },
      makeKey,
    );
    expect(otherAmount.key).toBe("key-2");
    const otherNote = resolveRefundKey(
      otherAmount,
      { amount: { amount: 4000, currency: "UAH" }, note: "Other" },
      makeKey,
    );
    expect(otherNote.key).toBe("key-3");
  });
});

describe("opening the refund dialog", () => {
  const p = payment(18900, 18900);
  const makeKey = () => "fresh";

  it("starts from the remaining amount with a fresh key", () => {
    const state = openRefundDialog(null, p, 2, makeKey);
    expect(state.values).toEqual({ amount: "189.00", note: "" });
    expect(state.draft).toEqual({ key: "fresh", sent: null });
    expect(state.retrying).toBe(false);
  });

  it("restores the values and the key of an attempt that got no answer, for the same payment only", () => {
    const attempt = {
      paymentId: p.id,
      values: { amount: "50.00", note: "Damaged" },
      draft: { key: "old", sent: { amount: 5000, currency: "UAH", note: "Damaged" } },
    };
    const same = openRefundDialog(attempt, p, 2, makeKey);
    expect(same.values).toEqual({ amount: "50.00", note: "Damaged" });
    expect(same.draft.key).toBe("old");
    expect(same.retrying).toBe(true);
    const other = openRefundDialog(attempt, paymentFixture({ id: "other" }), 2, makeKey);
    expect(other.draft.key).toBe("fresh");
    expect(other.retrying).toBe(false);
  });
});
