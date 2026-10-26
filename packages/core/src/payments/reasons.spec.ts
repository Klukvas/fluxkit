import { describe, expect, it } from "vitest";
import {
  PAYMENT_ATTENTION_CODES,
  PAYMENT_CREATED_BY,
  PAYMENT_EVENT_SOURCES,
  PAYMENT_PROBLEM_CODES,
  PAYMENT_RULE_VIOLATIONS,
  REFUND_REASONS,
} from "./reasons.js";

describe("payment codes (ADR 0032 decisions 5 and 18)", () => {
  it("has exactly the problem and rule codes of decision 18", () => {
    expect([...PAYMENT_PROBLEM_CODES]).toEqual(["payment_provider_unavailable"]);
    expect([...PAYMENT_RULE_VIOLATIONS]).toEqual([
      "payment_in_progress",
      "payment_window_too_short",
      "payment_not_available",
      "refund_not_allowed",
      "refund_exceeds_remaining",
      "partial_refund_not_supported",
    ]);
  });

  it("has the stored value lists of decision 5", () => {
    expect([...REFUND_REASONS]).toEqual([
      "admin",
      "late_payment",
      "duplicate_payment",
      "amount_mismatch",
    ]);
    expect([...PAYMENT_EVENT_SOURCES]).toEqual(["webhook", "poll", "create", "admin", "system"]);
    expect([...PAYMENT_CREATED_BY]).toEqual(["customer", "guest", "admin"]);
  });

  it("has one attention code per case an admin must see", () => {
    expect([...PAYMENT_ATTENTION_CODES]).toEqual([
      "late_payment",
      "duplicate_payment",
      "amount_mismatch",
      "fact_not_bound",
      "unknown_provider_status",
      "unexpected_provider_status",
      "external_reversal",
      "refund_failed",
      "refund_mismatch",
      "reconcile_gave_up",
    ]);
  });
});
