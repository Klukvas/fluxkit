import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdminOrder, AdminPayment } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  EMPTY_MARK_PAID,
  PAYMENT_REFERENCE_MAX_LENGTH,
  isMarkPaidDirty,
  markPaidCheckAfterUnknown,
  planMarkPaid,
  showNoCardPaymentNote,
  valuesForRetry,
  type MarkPaidValues,
} from "./mark-paid-form";

const openapi = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../../docs/api/openapi.json"), "utf8"),
) as {
  paths: Record<
    string,
    {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: Record<string, { description?: string; properties?: object }>;
                required: string[];
                additionalProperties: boolean;
              };
            };
          };
        };
      };
    }
  >;
};
const markPaidSchema =
  openapi.paths["/admin/orders/{id}/mark-paid"]?.post.requestBody.content["application/json"]
    .schema;

type Totals = Pick<AdminOrder, "total" | "currency">;
const order: Totals = { total: { amount: 123456, currency: "UAH" }, currency: "UAH" };

function values(overrides: Partial<MarkPaidValues> = {}): MarkPaidValues {
  return { reference: "BANK-2026-0042", received: true, ...overrides };
}

describe("mark-paid form (owner answer 8: the amount is the order total, read-only)", () => {
  it("has no amount field: the values are the reference and the confirmation only", () => {
    expect(Object.keys(EMPTY_MARK_PAID).sort()).toEqual(["received", "reference"]);
    expect(EMPTY_MARK_PAID).toEqual({ reference: "", received: false });
  });

  it("sends the order total exactly as stored (integer minor units, the order's currency)", () => {
    const plan = planMarkPaid(values(), order);
    expect(plan).toEqual({
      ok: true,
      body: { reference: "BANK-2026-0042", amount: { amount: 123456, currency: "UAH" } },
    });
    if (!plan.ok) throw new Error("expected a plan");
    expect(Number.isSafeInteger(plan.body.amount.amount)).toBe(true);
    // A copy, so nothing the dialog holds can change the order on screen or the other way round.
    expect(plan.body.amount).not.toBe(order.total);
  });

  it("takes whatever total the order has, also the largest amount and zero", () => {
    for (const amount of [0, 1, 99, 1_000_000_000_000]) {
      const plan = planMarkPaid(values(), {
        total: { amount, currency: "KWD" },
        currency: "KWD",
      });
      expect(plan.ok && plan.body.amount, String(amount)).toEqual({ amount, currency: "KWD" });
    }
  });

  it("matches the API's body: exactly reference and amount, 1 to 255 characters", () => {
    expect(markPaidSchema?.additionalProperties).toBe(false);
    expect(Object.keys(markPaidSchema?.properties ?? {}).sort()).toEqual(["amount", "reference"]);
    expect(markPaidSchema?.required.sort()).toEqual(["amount", "reference"]);
    expect(markPaidSchema?.properties.reference?.description).toContain(
      `1 to ${String(PAYMENT_REFERENCE_MAX_LENGTH)} characters`,
    );
    const plan = planMarkPaid(values(), order);
    expect(plan.ok && Object.keys(plan.body).sort()).toEqual(["amount", "reference"]);
  });

  it("needs the confirmation that this amount was received", () => {
    expect(planMarkPaid(values({ received: false }), order)).toEqual({
      ok: false,
      issues: { received: "confirmation_required" },
    });
  });

  it("needs a reference, trimmed like the API, at most 255 characters, without control characters", () => {
    expect(planMarkPaid(values({ reference: "   " }), order)).toEqual({
      ok: false,
      issues: { reference: "required" },
    });
    expect(planMarkPaid(values({ reference: "  R-1  " }), order)).toMatchObject({
      ok: true,
      body: { reference: "R-1" },
    });
    expect(planMarkPaid(values({ reference: "x".repeat(255) }), order).ok).toBe(true);
    expect(planMarkPaid(values({ reference: ` ${"x".repeat(255)} ` }), order).ok).toBe(true);
    expect(planMarkPaid(values({ reference: "x".repeat(256) }), order)).toEqual({
      ok: false,
      issues: { reference: "too_long" },
    });
    for (const bad of ["a\u0000b", "a\u0007b", "a\u007fb", "a\u0085b", "a\u009fb"]) {
      expect(planMarkPaid(values({ reference: bad }), order), JSON.stringify(bad)).toEqual({
        ok: false,
        issues: { reference: "invalid_characters" },
      });
    }
    // The API allows tab and line breaks inside (it refuses other control characters only).
    expect(planMarkPaid(values({ reference: "a\tb" }), order).ok).toBe(true);
  });

  it("reports every problem at once", () => {
    expect(planMarkPaid({ reference: "", received: false }, order)).toEqual({
      ok: false,
      issues: { reference: "required", received: "confirmation_required" },
    });
  });

  it("is dirty once anything was typed or ticked", () => {
    expect(isMarkPaidDirty(EMPTY_MARK_PAID)).toBe(false);
    expect(isMarkPaidDirty({ reference: "R", received: false })).toBe(true);
    expect(isMarkPaidDirty({ reference: "", received: true })).toBe(true);
  });
});

describe("after a lost answer (mark-paid is idempotent by reference)", () => {
  it("tells from the reloaded order whether the payment with that reference was recorded", () => {
    const base = { paymentReference: null, status: "awaiting_payment" as const };
    expect(markPaidCheckAfterUnknown(base, "R-1")).toBe("not_recorded");
    expect(markPaidCheckAfterUnknown({ status: "paid", paymentReference: "R-1" }, "R-1")).toBe(
      "recorded",
    );
    expect(markPaidCheckAfterUnknown({ status: "fulfilled", paymentReference: "R-1" }, "R-1")).toBe(
      "recorded",
    );
    expect(markPaidCheckAfterUnknown({ status: "paid", paymentReference: "OTHER" }, "R-1")).toBe(
      "paid_with_other_reference",
    );
    expect(markPaidCheckAfterUnknown({ status: "cancelled", paymentReference: null }, "R-1")).toBe(
      "not_payable",
    );
    expect(markPaidCheckAfterUnknown({ status: "expired", paymentReference: null }, "R-1")).toBe(
      "not_payable",
    );
  });

  it("keeps the SAME reference for a retry by the admin and asks for the confirmation again", () => {
    expect(valuesForRetry({ reference: "R-1", amount: { amount: 5, currency: "UAH" } })).toEqual({
      reference: "R-1",
      received: false,
    });
  });
});

describe("the note that no card payment has succeeded (UX round 2, review m2 of PR 235)", () => {
  const attempts = (...statuses: AdminPayment["status"][]) =>
    statuses.map((status) => ({ status }));

  it("is shown while online payment is on and no attempt succeeded or is under way", () => {
    expect(showNoCardPaymentNote(true, [])).toBe(true);
    // Failed, expired or closed attempts: the customer can still pay by card, and mark paid would end that.
    expect(showNoCardPaymentNote(true, attempts("failed", "expired", "invalidated"))).toBe(true);
    // An open payment page: mark paid closes it and a late success is refunded automatically.
    expect(showNoCardPaymentNote(true, attempts("awaiting_customer"))).toBe(true);
  });

  it("is hidden without online payment, after a success, and while a payment is under way (mark paid is refused then)", () => {
    expect(showNoCardPaymentNote(false, [])).toBe(false);
    expect(showNoCardPaymentNote(true, attempts("failed", "succeeded"))).toBe(false);
    for (const status of ["creating", "processing", "create_unknown"] as const) {
      expect(showNoCardPaymentNote(true, attempts("failed", status)), status).toBe(false);
    }
  });
});
