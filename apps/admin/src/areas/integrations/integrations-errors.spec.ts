import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  INTEGRATION_REFUSAL_RULES,
  VALUE_ERROR_CODES,
  localSecretErrors,
  secretProblemErrors,
} from "./integrations-errors";

function problem(overrides: Partial<ProblemDetails>): ProblemDetails {
  return {
    type: "about:blank",
    title: "Problem",
    status: 400,
    code: "validation_failed",
    detail: "English text of the API that must never be shown.",
    ...overrides,
  };
}

describe("secretProblemErrors", () => {
  it("puts a wrong password on the password field", () => {
    const mapped = secretProblemErrors(
      403,
      problem({ status: 403, code: "forbidden", rule: "current_password_incorrect" }),
      null,
    );
    expect(mapped).toEqual({
      fields: { currentPassword: { key: "intg.error.passwordIncorrect" } },
      form: [],
      stale: false,
    });
  });

  it("keeps a 403 without that rule a missing permission, on the form", () => {
    const mapped = secretProblemErrors(403, problem({ status: 403, code: "forbidden" }), null);
    expect(mapped.fields).toEqual({});
    expect(mapped.form).toEqual([{ key: "errors.code.forbidden" }]);
  });

  it.each(VALUE_ERROR_CODES)(
    "puts the value error %s on the key field with its own message",
    (code) => {
      const mapped = secretProblemErrors(
        400,
        problem({
          errors: [{ path: "value", code, message: "Raw English from a provider plugin." }],
        }),
        null,
      );
      expect(mapped.fields).toEqual({ value: { key: `intg.error.value.${code}` } });
      expect(mapped.form).toEqual([]);
      expect(JSON.stringify(mapped)).not.toContain("English");
    },
  );

  it("keeps the first error of a field and sends an error without a field to the form", () => {
    const mapped = secretProblemErrors(
      400,
      problem({
        errors: [
          { path: "value", code: "invalid_characters", message: "x" },
          { path: "value", code: "too_long", message: "x" },
          { path: "currentPassword", code: "required", message: "x" },
          { path: "expectedRevision", code: "invalid_type", message: "x" },
        ],
      }),
      null,
    );
    expect(mapped.fields).toEqual({
      value: { key: "intg.error.value.invalid_characters" },
      currentPassword: { key: "errors.reason.required" },
    });
    expect(mapped.form).toEqual([{ key: "errors.reason.invalid_type" }]);
  });

  it("shows an unknown value code with the generic message and the code for support", () => {
    const mapped = secretProblemErrors(
      400,
      problem({ errors: [{ path: "value", code: "brand_new_code", message: "x" }] }),
      null,
    );
    expect(mapped.fields.value).toEqual({ key: "errors.generic", code: "brand_new_code" });
  });

  it.each(INTEGRATION_REFUSAL_RULES)("explains the refusal %s on the form", (rule) => {
    const status = rule === "step_up_unavailable" ? 503 : 409;
    const code =
      rule === "step_up_unavailable"
        ? "service_unavailable"
        : rule === "integration_version_not_retirable"
          ? "invalid_transition"
          : "rule_violation";
    const mapped = secretProblemErrors(status, problem({ status, code, rule }), null);
    expect(mapped.fields).toEqual({});
    expect(mapped.form).toEqual([{ key: `intg.refusal.${rule}` }]);
    expect(mapped.stale).toBe(rule === "integration_revision_stale");
  });

  it("names the wait of a 429 in whole minutes, and no wait without a usable header", () => {
    const limited = problem({ status: 429, code: "too_many_requests" });
    expect(secretProblemErrors(429, limited, "61").form).toEqual([
      { key: "intg.refusal.rateLimitedWait", values: { minutes: 2 } },
    ]);
    expect(secretProblemErrors(429, limited, null).form).toEqual([
      { key: "intg.refusal.rateLimited" },
    ]);
    expect(secretProblemErrors(429, limited, "soon").form).toEqual([
      { key: "intg.refusal.rateLimited" },
    ]);
  });

  it("sends everything else through the shell's problem map", () => {
    expect(
      secretProblemErrors(404, problem({ status: 404, code: "not_found" }), null).form,
    ).toEqual([{ key: "errors.code.not_found" }]);
    expect(
      secretProblemErrors(500, problem({ status: 500, code: "internal_error" }), null).form,
    ).toEqual([{ key: "errors.code.internal_error" }]);
    expect(
      secretProblemErrors(503, problem({ status: 503, code: "service_unavailable" }), null).form,
    ).toEqual([{ key: "errors.code.service_unavailable" }]);
  });
});

describe("localSecretErrors", () => {
  it("refuses an empty or blank key and an empty password before anything is sent", () => {
    expect(localSecretErrors({ value: "   ", currentPassword: "" })).toEqual({
      value: { key: "intg.error.value.required" },
      currentPassword: { key: "intg.error.passwordRequired" },
    });
  });

  it("accepts filled fields, and a password of spaces (the API decides about it)", () => {
    expect(localSecretErrors({ value: " key ", currentPassword: "  " })).toEqual({});
  });

  it("checks only the fields the form has (a removal has no key field)", () => {
    expect(localSecretErrors({ currentPassword: "x" })).toEqual({});
    expect(localSecretErrors({ currentPassword: "" })).toEqual({
      currentPassword: { key: "intg.error.passwordRequired" },
    });
  });
});
