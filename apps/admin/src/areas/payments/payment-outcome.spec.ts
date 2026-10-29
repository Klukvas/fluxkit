import type { ProblemDetails } from "@fluxkit/api-client";
import { PAYMENT_RULE_VIOLATIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { paymentFixture, refundFixture } from "../../test-helpers";
import {
  PAYMENT_REFUSAL_RULES,
  describePaymentProblem,
  refundFieldErrors,
  refundNotice,
  waitSeconds,
} from "./payment-outcome";

function problem(overrides: Partial<ProblemDetails>): ProblemDetails {
  return {
    type: "about:blank",
    title: "x",
    status: 409,
    code: "rule_violation",
    detail: "An English detail that must never be shown.",
    ...overrides,
  };
}

describe("the refusals of the payment routes", () => {
  it("explains every rule core names for payments", () => {
    for (const rule of PAYMENT_RULE_VIOLATIONS) {
      expect(PAYMENT_REFUSAL_RULES as readonly string[], rule).toContain(rule);
      expect(describePaymentProblem(409, problem({ rule }), null)).toEqual({
        key: `payments.refusal.${rule}`,
      });
    }
  });

  it("explains an over-refund, a payment that cannot be refunded and a provider that cannot do partial refunds", () => {
    expect(
      describePaymentProblem(409, problem({ rule: "refund_exceeds_remaining" }), null).key,
    ).toBe("payments.refusal.refund_exceeds_remaining");
    expect(describePaymentProblem(409, problem({ rule: "refund_not_allowed" }), null).key).toBe(
      "payments.refusal.refund_not_allowed",
    );
    expect(
      describePaymentProblem(409, problem({ rule: "partial_refund_not_supported" }), null).key,
    ).toBe("payments.refusal.partial_refund_not_supported");
  });

  it("says a payment_in_progress refusal in the payments words", () => {
    expect(describePaymentProblem(409, problem({ rule: "payment_in_progress" }), null).key).toBe(
      "payments.refusal.payment_in_progress",
    );
  });

  it("explains a repeated key with another request", () => {
    expect(describePaymentProblem(409, problem({ code: "idempotency_key_reused" }), null)).toEqual({
      key: "payments.refusal.keyReused",
    });
  });

  it("says a 503 from the provider, with the wait only when Retry-After is a plausible number of seconds", () => {
    const unavailable = problem({ status: 503, code: "payment_provider_unavailable" });
    expect(describePaymentProblem(503, unavailable, null)).toEqual({ key: "payments.unavailable" });
    expect(describePaymentProblem(503, unavailable, "30")).toEqual({
      key: "payments.unavailableRetry",
      values: { seconds: 30 },
    });
    expect(describePaymentProblem(503, unavailable, "soon")).toEqual({
      key: "payments.unavailable",
    });
    expect(waitSeconds("0")).toBeNull();
    expect(waitSeconds("99999")).toBeNull();
    expect(waitSeconds("-5")).toBeNull();
    expect(waitSeconds("45")).toBe(45);
  });

  it("leaves everything else to the shell's map and never shows the English detail", () => {
    for (const [status, code] of [
      [403, "forbidden"],
      [404, "not_found"],
      [429, "too_many_requests"],
    ] as const) {
      const descriptor = describePaymentProblem(status, problem({ status, code }), null);
      expect(descriptor.key).toBe(`errors.code.${code}`);
    }
    const unknownRule = describePaymentProblem(409, problem({ rule: "something_new" }), null);
    expect(unknownRule.key).toBe("errors.code.rule_violation");
    expect(JSON.stringify(unknownRule)).not.toContain("English detail");
  });
});

describe("a 400 on the refund body", () => {
  it("maps the amount and note errors to their fields and keeps the rest for the summary", () => {
    const found = refundFieldErrors(
      problem({
        status: 400,
        code: "validation_failed",
        errors: [
          { path: "amount.amount", code: "invalid_amount" },
          { path: "amount.currency", code: "currency_mismatch" },
          { path: "note", code: "too_long" },
          { path: "extra", code: "unknown_field" },
        ],
      }),
    );
    expect(found.amount).toEqual({ key: "payments.field.invalid_amount" });
    expect(found.note).toEqual({ key: "errors.reason.too_long" });
    expect(found.other).toEqual([{ key: "errors.reason.unknown_field" }]);
  });

  it("explains a currency mismatch on the amount field", () => {
    const found = refundFieldErrors(
      problem({
        status: 400,
        code: "validation_failed",
        errors: [{ path: "amount", code: "currency_mismatch" }],
      }),
    );
    expect(found.amount).toEqual({ key: "payments.field.currency_mismatch" });
  });
});

describe("the notice after a refund answer", () => {
  const payment = paymentFixture();

  it("carries the refund status as the provider left it, every one of the five", () => {
    for (const status of ["succeeded", "processing", "failed", "requested", "unknown"] as const) {
      const notice = refundNotice({ refund: refundFixture({ status }), payment }, 202);
      expect(notice).toMatchObject({ kind: "refund", status, replay: false });
    }
  });

  it("marks a 200 as a replay of an earlier identical request and keeps the amount and failure code", () => {
    const notice = refundNotice(
      {
        refund: refundFixture({ status: "failed", failureCode: "refund_declined" }),
        payment,
      },
      200,
    );
    expect(notice).toEqual({
      kind: "refund",
      status: "failed",
      amount: { amount: 5000, currency: "UAH" },
      failureCode: "refund_declined",
      replay: true,
    });
  });
});
