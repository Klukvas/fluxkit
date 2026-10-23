import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTranslator, locales } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { eagerMessages } from "../messages";
import {
  KNOWN_PROBLEM_CODES,
  KNOWN_REASON_CODES,
  describeFailure,
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "./problem-messages";

const docsRoot = resolve(import.meta.dirname, "../../../../docs/api");
const openapi = JSON.parse(readFileSync(resolve(docsRoot, "openapi.json"), "utf8")) as {
  components: { schemas: { ProblemDetailsDoc: { properties: { code: { enum: string[] } } } } };
};
const apiProblemCodes = openapi.components.schemas.ProblemDetailsDoc.properties.code.enum;

/** The pages that document the admin routes and their errors (the store-only `cart.md` is not one of them). */
const ADMIN_DOCS = [
  "catalog.md",
  "pricing.md",
  "inventory.md",
  "orders.md",
  "customers.md",
  "auth.md",
  "media.md",
];

/**
 * Snake-case words in those pages that are NOT codes a problem answer can carry: column, table and cookie names, statuses,
 * availability values, cart notices, server log reasons and job results. Every other such word must have a message.
 */
const NOT_ERROR_CODES = new Set([
  "access_expires_at",
  "access_token_hash",
  "actor_admin_id",
  "admin_user",
  "awaiting_payment",
  "byte_size",
  "content_type",
  "created_at",
  "created_by",
  "customer_session",
  "expires_at",
  "first_attached_at",
  "fluxkit_admin_session",
  "fluxkit_cart",
  "fluxkit_customer_session",
  "in_stock",
  "inventory_level",
  "ip_throttled",
  "last_login_at",
  "last_seen_at",
  "lines_dropped",
  "low_stock",
  "media_upload",
  "not_due",
  "on_hand",
  "order_item_reservation",
  "order_status_change",
  "out_of_stock",
  "pg_advisory_xact_lock",
  "placed_at",
  "quantity_capped",
  "release_unsold",
  "requires_shipping",
  "sales_order",
  "stock_movement",
  "storage_key",
  "text_pattern_ops",
  "unknown_account",
  "wrong_password",
]);

function documentedWords(): Set<string> {
  const words = new Set<string>();
  for (const file of ADMIN_DOCS) {
    const text = readFileSync(resolve(docsRoot, file), "utf8");
    for (const match of text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) {
      words.add(match[1] as string);
    }
  }
  return words;
}

const allKeys = (descriptors: MessageDescriptor[]) => descriptors.map((entry) => entry.key);

describe("problem code map", () => {
  it("lists exactly the API's problem codes (ProblemDetailsDoc.code), so a new code needs a decision here", () => {
    expect([...KNOWN_PROBLEM_CODES].sort()).toEqual([...apiProblemCodes].sort());
  });

  it("covers every code, rule and field error code the admin pages document", () => {
    const words = documentedWords();
    expect(words.size).toBeGreaterThan(80);
    const known = new Set<string>([...KNOWN_PROBLEM_CODES, ...KNOWN_REASON_CODES]);
    const missing = [...words].filter((word) => !known.has(word) && !NOT_ERROR_CODES.has(word));
    expect(missing).toEqual([]);
  });

  it("keeps the list of words that are not codes current (each still appears in the pages)", () => {
    const words = documentedWords();
    expect([...NOT_ERROR_CODES].filter((word) => !words.has(word))).toEqual([]);
  });

  it("has a message in every locale for every code, reason and transport error", () => {
    const keys = [
      ...KNOWN_PROBLEM_CODES.map((code) => describeProblem(400, { code }).key),
      ...KNOWN_REASON_CODES.map((code) => describeFieldError(code).key),
      ...allKeys([
        describeFailure({ kind: "network" }),
        describeFailure({ kind: "timeout" }),
        describeFailure({ kind: "invalidResponse" }),
        describeProblem(413, { code: "validation_failed" }),
        describeProblem(400, { code: "brand_new_code" }),
      ]),
      "errors.reference",
    ];
    expect(keys.length).toBeGreaterThan(100);
    for (const locale of locales) {
      const messages = eagerMessages[locale];
      for (const key of keys) expect(messages[key], `${locale} ${key}`).toBeTruthy();
    }
  });
});

describe("describeProblem", () => {
  it("maps a known code to its message and a known rule of a rule_violation to the rule's message", () => {
    expect(describeProblem(404, { code: "not_found" })).toEqual({ key: "errors.code.not_found" });
    expect(describeProblem(409, { code: "rule_violation", rule: "has_stock_history" })).toEqual({
      key: "errors.reason.has_stock_history",
    });
    expect(describeProblem(409, { code: "invalid_transition", rule: "draft_to_archived" })).toEqual(
      {
        key: "errors.code.invalid_transition",
      },
    );
  });

  it("shows the generic message and the code in small print for an unknown code", () => {
    expect(describeProblem(400, { code: "brand_new_code" })).toEqual({
      key: "errors.generic",
      code: "brand_new_code",
    });
  });

  it("shows the code's message and the rule in small print for an unknown rule", () => {
    expect(describeProblem(409, { code: "rule_violation", rule: "brand_new_rule" })).toEqual({
      key: "errors.code.rule_violation",
      code: "brand_new_rule",
    });
  });

  it("gives a 413 (body too large) its own message whatever the code", () => {
    expect(describeProblem(413, { code: "validation_failed" })).toEqual({
      key: "errors.payloadTooLarge",
    });
  });

  it("never shows the API's English detail", () => {
    const t = createTranslator(eagerMessages.en, "en");
    const problem = { code: "conflict", detail: "SECRET-DETAIL-FROM-API" };
    const descriptor = describeProblem(409, problem);
    expect(t(descriptor.key)).not.toContain("SECRET");
    expect(JSON.stringify(descriptor)).not.toContain("SECRET");
  });
});

describe("describeFieldError and describeFailure", () => {
  it("maps a known field error code and falls back with the code for an unknown one", () => {
    expect(describeFieldError("too_short")).toEqual({ key: "errors.reason.too_short" });
    expect(describeFieldError("brand_new_field_code")).toEqual({
      key: "errors.generic",
      code: "brand_new_field_code",
    });
  });

  it("describes thrown client errors and problems", () => {
    expect(describeFailure({ kind: "network" })).toEqual({ key: "errors.network" });
    expect(describeFailure({ kind: "timeout" })).toEqual({ key: "errors.timeout" });
    expect(describeFailure({ kind: "invalidResponse" })).toEqual({ key: "errors.invalidResponse" });
    expect(
      describeFailure({
        kind: "problem",
        status: 409,
        retryAfter: null,
        problem: {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "in_use",
          detail: "x",
        },
      }),
    ).toEqual({ key: "errors.code.in_use" });
  });
});
