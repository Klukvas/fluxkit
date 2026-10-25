import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  SHIPPING_REASONS,
  deleteProblemMapper,
  describeMethodRefusal,
  describeShippingReason,
  fieldOfPath,
  methodProblemMapper,
  safeProviderCodes,
} from "./shipping-errors";

function problem(extra: Partial<ProblemDetails>): ProblemDetails {
  return {
    type: "about:blank",
    title: "x",
    status: 400,
    code: "validation_failed",
    detail: "SECRET-ENGLISH-DETAIL",
    ...extra,
  };
}

const FIELDS = [
  "code",
  "countryCodes",
  "providerCode",
  "pricing.amount",
  "pricing.tiers.1.amount",
  "title.uk",
];

describe("describeShippingReason", () => {
  it("gives each shipping reason its own message and passes other codes to the shell's map", () => {
    for (const reason of SHIPPING_REASONS) {
      expect(describeShippingReason(reason)).toEqual({ key: `ship.reason.${reason}` });
    }
    expect(describeShippingReason("too_long")).toEqual({ key: "errors.reason.too_long" });
    expect(describeShippingReason("brand_new_reason")).toEqual({
      key: "errors.generic",
      code: "brand_new_reason",
    });
  });
});

describe("methodProblemMapper", () => {
  it("puts each error on the field of its path, the first error of a field wins", () => {
    const mapped = methodProblemMapper(
      problem({
        errors: [
          { path: "pricing.tiers.1.amount", code: "not_an_integer" },
          { path: "pricing.amount", code: "required" },
          { path: "pricing.amount", code: "out_of_range" },
          { path: "providerCode", code: "provider_not_enabled" },
        ],
      }),
      400,
      FIELDS,
    );
    expect(mapped.fields).toEqual({
      "pricing.tiers.1.amount": { key: "errors.reason.not_an_integer" },
      "pricing.amount": { key: "errors.reason.required" },
      providerCode: { key: "ship.reason.provider_not_enabled" },
    });
    expect(mapped.other).toEqual([]);
  });

  it("maps countryCodes.N to the country list, and sends an error without a field to the summary", () => {
    expect(fieldOfPath("countryCodes.3")).toBe("countryCodes");
    expect(fieldOfPath("countryCodes")).toBe("countryCodes");
    expect(fieldOfPath("pricing.tiers.3.amount")).toBe("pricing.tiers.3.amount");
    const mapped = methodProblemMapper(
      problem({
        errors: [
          { path: "countryCodes.2", code: "duplicate_country" },
          { path: "pricing.currency", code: "unknown_field" },
        ],
      }),
      400,
      FIELDS,
    );
    expect(mapped.fields).toEqual({ countryCodes: { key: "ship.reason.duplicate_country" } });
    expect(mapped.other).toEqual([{ key: "errors.reason.unknown_field" }]);
  });

  it("explains a taken code on the code field, and never shows the API's English detail", () => {
    const mapped = methodProblemMapper(
      problem({ status: 409, code: "conflict", field: "code" }),
      409,
      FIELDS,
    );
    expect(mapped).toEqual({ fields: { code: { key: "ship.error.codeTaken" } }, other: [] });
    expect(JSON.stringify(mapped)).not.toContain("SECRET");
    expect(JSON.stringify(methodProblemMapper(problem({}), 400, FIELDS))).not.toContain("SECRET");
  });
});

describe("the delete refusal", () => {
  it("explains method_in_use (a 409 rule violation) and suggests deactivating", () => {
    const refused = problem({ status: 409, code: "rule_violation", rule: "method_in_use" });
    expect(describeMethodRefusal(409, refused)).toEqual({ key: "ship.refusal.method_in_use" });
    expect(deleteProblemMapper(refused, 409)).toEqual({
      fields: {},
      other: [{ key: "ship.refusal.method_in_use" }],
    });
  });

  it("leaves every other answer to the shell's messages", () => {
    expect(describeMethodRefusal(404, problem({ status: 404, code: "not_found" }))).toEqual({
      key: "errors.code.not_found",
    });
    expect(
      describeMethodRefusal(
        409,
        problem({ status: 409, code: "rule_violation", rule: "other_rule" }),
      ),
    ).toEqual({ key: "errors.code.rule_violation", code: "other_rule" });
    expect(describeMethodRefusal(403, problem({ status: 403, code: "forbidden" }))).toEqual({
      key: "errors.code.forbidden",
    });
  });
});

describe("safeProviderCodes", () => {
  it("keeps only short raw codes without spaces (never a carrier message)", () => {
    expect(safeProviderCodes(["E_1", "A.b-c", "has space", "x".repeat(33), "", "<b>"])).toEqual([
      "E_1",
      "A.b-c",
    ]);
    expect(safeProviderCodes(undefined)).toEqual([]);
  });
});
