import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { KNOWN_PROBLEM_CODES, KNOWN_REASON_CODES } from "../../lib/problem-messages";
import {
  ERASURE_REASONS,
  PRIVACY_REFUSAL_RULES,
  blockerReasonKey,
  describePrivacyProblem,
  readErasureReasons,
} from "./privacy-errors";

function problem(extra: Record<string, unknown>): ProblemDetails {
  return {
    type: "about:blank",
    title: "x",
    status: 409,
    code: "rule_violation",
    detail: "SECRET-ENGLISH-DETAIL",
    ...extra,
  } as ProblemDetails;
}

describe("blockerReasonKey", () => {
  it("gives every erasure blocker its own friendly message (hand-written list of docs/api/privacy.md)", () => {
    expect([...ERASURE_REASONS].sort()).toEqual(
      [
        "active_shipment",
        "mail_sending",
        "open_order",
        "payment_in_progress",
        "refund_in_progress",
      ].sort(),
    );
    for (const reason of ERASURE_REASONS) {
      expect(blockerReasonKey(reason)).toBe(`personal.blocker.${reason}`);
    }
  });

  it("shows an unknown reason generically instead of inventing a meaning", () => {
    expect(blockerReasonKey("brand_new_reason")).toBe("personal.blocker.unknown");
  });
});

describe("readErasureReasons", () => {
  it("reads the known reasons of an erasure_blocked answer, without duplicates, in a stable order", () => {
    const body = problem({
      rule: "erasure_blocked",
      reasons: ["active_shipment", "open_order", "open_order"],
    });
    expect(readErasureReasons(body)).toEqual(["open_order", "active_shipment"]);
  });

  it("keeps an unknown reason visible as unknown and ignores junk", () => {
    expect(readErasureReasons(problem({ reasons: ["new_one", 3, null, "open_order"] }))).toEqual([
      "open_order",
      "new_one",
    ]);
    expect(readErasureReasons(problem({ reasons: "open_order" }))).toEqual([]);
    expect(readErasureReasons(problem({}))).toEqual([]);
  });
});

describe("describePrivacyProblem", () => {
  it("explains each refusal rule of docs/api/privacy.md in its own message", () => {
    expect([...PRIVACY_REFUSAL_RULES].sort()).toEqual(
      [
        "contact_erased",
        "erasure_blocked",
        "export_too_large",
        "not_an_erasure_request",
        "request_closed",
        "subject_not_found",
      ].sort(),
    );
    for (const rule of PRIVACY_REFUSAL_RULES) {
      expect(describePrivacyProblem(409, problem({ rule }), null)).toEqual({
        key: `personal.refusal.${rule}`,
      });
    }
  });

  it("explains a different email in the body of an email subject (400, subject_mismatch)", () => {
    const body = problem({
      code: "validation_failed",
      status: 400,
      errors: [{ path: "email", code: "subject_mismatch" }],
    });
    expect(describePrivacyProblem(400, body, null)).toEqual({
      key: "personal.refusal.subject_mismatch",
    });
  });

  it("answers a 429 with the wait in minutes when the header is plausible, without it otherwise", () => {
    const limited = problem({ code: "too_many_requests", status: 429 });
    expect(describePrivacyProblem(429, limited, "120")).toEqual({
      key: "personal.refusal.rateLimitedWait",
      values: { minutes: 2 },
    });
    expect(describePrivacyProblem(429, limited, null)).toEqual({
      key: "personal.refusal.rateLimited",
    });
    expect(describePrivacyProblem(429, limited, "soon")).toEqual({
      key: "personal.refusal.rateLimited",
    });
  });

  it("leaves every other answer to the shell's problem map and never shows the English detail", () => {
    expect(describePrivacyProblem(404, problem({ code: "not_found", status: 404 }), null)).toEqual({
      key: "errors.code.not_found",
    });
    expect(describePrivacyProblem(409, problem({ rule: "brand_new_rule" }), null)).toEqual({
      key: "errors.code.rule_violation",
      code: "brand_new_rule",
    });
    expect(
      JSON.stringify(describePrivacyProblem(409, problem({ rule: "request_closed" }), null)),
    ).not.toContain("SECRET");
  });
});

describe("docs/api/privacy.md", () => {
  const text = readFileSync(
    resolve(import.meta.dirname, "../../../../../docs/api/privacy.md"),
    "utf8",
  );
  const words = new Set<string>();
  for (const match of text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g))
    words.add(match[1] as string);

  /** Words of the page that are not codes of a problem answer: columns, tables, statuses and a reject reason. */
  const NOT_ERROR_CODES = new Set([
    "awaiting_customer",
    "awaiting_payment",
    "cancellation_reason",
    "contact_erased_at",
    "create_unknown",
    "customer_id",
    "identity_not_confirmed",
    "in_progress",
    "in_transit",
    "privacy_request",
    "request_fingerprint",
  ]);

  it("has a message for every rule and reason the page names (a new word needs a decision here)", () => {
    const known = new Set<string>([
      ...KNOWN_PROBLEM_CODES,
      ...KNOWN_REASON_CODES,
      ...PRIVACY_REFUSAL_RULES,
      ...ERASURE_REASONS,
    ]);
    expect([...words].filter((word) => !known.has(word) && !NOT_ERROR_CODES.has(word))).toEqual([]);
  });

  it("keeps the list of words that are not codes current (each still appears in the page)", () => {
    expect([...NOT_ERROR_CODES].filter((word) => !words.has(word))).toEqual([]);
  });
});
