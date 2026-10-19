import { createTranslator, locales } from "@fluxkit/ui";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FIELD_ERROR_CODES,
  KNOWN_PROBLEM_CODES,
  KNOWN_RULES,
  fieldErrorMessage,
  problemMessage,
  problemMessageKey,
  fieldErrorMessageKey,
  transportErrorMessageKey,
} from "./problem-messages";
import { messagesByLocale } from "../messages";

const openapi = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../../docs/api/openapi.json"), "utf8"),
) as {
  components: { schemas: { ProblemDetailsDoc: { properties: { code: { enum: string[] } } } } };
};
const apiProblemCodes = openapi.components.schemas.ProblemDetailsDoc.properties.code.enum;

describe("problem message map", () => {
  it("covers every problem code of the API (ProblemDetailsDoc.code) in every locale", () => {
    expect(apiProblemCodes.length).toBeGreaterThan(10);
    for (const locale of locales) {
      for (const code of apiProblemCodes) {
        expect(messagesByLocale[locale][`errors.${code}`], `${locale} errors.${code}`).toBeTruthy();
      }
    }
  });

  it("lists exactly the API's problem codes, so a new code needs a decision here", () => {
    expect([...KNOWN_PROBLEM_CODES].sort()).toEqual([...apiProblemCodes].sort());
  });

  it("has a message in every locale for every rule, field error code, transport error and the generic fallback", () => {
    const keys = [
      ...KNOWN_RULES.map((rule) => `errors.rule.${rule}`),
      ...FIELD_ERROR_CODES.map((code) => `errors.field.${code}`),
      "errors.generic",
      "errors.network",
      "errors.timeout",
      "errors.invalidResponse",
    ];
    for (const locale of locales) {
      for (const key of keys) {
        expect(messagesByLocale[locale][key], `${locale} ${key}`).toBeTruthy();
      }
    }
  });

  it("maps a code, a rule and a field error code to their own keys", () => {
    expect(problemMessageKey({ code: "cart_changed" })).toBe("errors.cart_changed");
    expect(problemMessageKey({ code: "too_many_open_orders" })).toBe("errors.too_many_open_orders");
    expect(problemMessageKey({ code: "rule_violation", rule: "quantity_limit" })).toBe(
      "errors.rule.quantity_limit",
    );
    expect(fieldErrorMessageKey("shipping_address_required")).toBe(
      "errors.field.shipping_address_required",
    );
    expect(transportErrorMessageKey("network")).toBe("errors.network");
    expect(transportErrorMessageKey("timeout")).toBe("errors.timeout");
  });

  it("falls back to the code's own message for an unknown rule, and to the generic message for an unknown code", () => {
    expect(problemMessageKey({ code: "rule_violation", rule: "something_new" })).toBe(
      "errors.rule_violation",
    );
    expect(problemMessageKey({ code: "brand_new_code" })).toBe("errors.generic");
    expect(fieldErrorMessageKey("brand_new_field_code")).toBe("errors.generic");
  });

  it("never shows the API's detail or message texts", () => {
    const t = createTranslator(messagesByLocale.en, "en");
    const problem = {
      code: "checkout_refused",
      detail: "SECRET-DETAIL-FROM-API",
      errors: [{ path: "lines.0", code: "insufficient_stock", message: "SECRET-FIELD-MESSAGE" }],
    };
    const text = problemMessage(t, problem);
    expect(text).not.toContain("SECRET");
    expect(text).toBe(messagesByLocale.en["errors.checkout_refused"]);
    const fieldError = { path: "lines.0", code: "insufficient_stock", message: "SECRET" };
    expect(fieldErrorMessage(t, fieldError)).toBe(
      messagesByLocale.en["errors.field.insufficient_stock"],
    );
    const unknownProblem = { code: "brand_new_code", detail: "SECRET-DETAIL-FROM-API" };
    const unknown = problemMessage(t, unknownProblem, { log: () => {} });
    expect(unknown).toBe(messagesByLocale.en["errors.generic"]);
  });

  it("logs the unknown code in development only", () => {
    const t = createTranslator(messagesByLocale.uk, "uk");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubEnv("NODE_ENV", "development");
      problemMessage(t, { code: "brand_new_code" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("brand_new_code");

      warn.mockClear();
      vi.stubEnv("NODE_ENV", "production");
      problemMessage(t, { code: "brand_new_code" });
      expect(warn).not.toHaveBeenCalled();

      // A known code is never logged.
      vi.stubEnv("NODE_ENV", "development");
      problemMessage(t, { code: "not_found" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      warn.mockRestore();
    }
  });
});
