import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  IDLE_SUBMIT,
  formErrorsFromProblem,
  stateAfterOutcome,
  stateWithIssues,
  summaryOf,
} from "./submit-errors";

function problem(
  overrides: Partial<ProblemDetails> & Pick<ProblemDetails, "code" | "status">,
): ProblemDetails {
  return { type: "about:blank", title: "t", detail: "SECRET", ...overrides };
}

const fields = ["code", "name.uk", "name.en", "validation.min_length", "slug"];

describe("formErrorsFromProblem", () => {
  it("puts a 400 validation error on the field of its path, with the translated code", () => {
    const result = formErrorsFromProblem(
      problem({
        code: "validation_failed",
        status: 400,
        errors: [
          { path: "name.uk", code: "default_locale_missing" },
          { path: "validation.min_length", code: "too_small" },
        ],
      }),
      400,
      fields,
    );
    expect(result.fields).toEqual({
      "name.uk": { key: "errors.reason.default_locale_missing" },
      "validation.min_length": { key: "errors.reason.too_small" },
    });
    expect(result.other).toEqual([]);
  });

  it("sends an error of a path the form has no field for to the summary, never drops it", () => {
    const result = formErrorsFromProblem(
      problem({
        code: "validation_failed",
        status: 400,
        errors: [
          { path: "name", code: "required" },
          { path: "", code: "invalid" },
        ],
      }),
      400,
      fields,
    );
    expect(result.fields).toEqual({});
    expect(result.other).toEqual([
      { key: "errors.reason.required" },
      { key: "errors.reason.invalid" },
    ]);
  });

  it("puts a 409 conflict on the field it names (a taken code or slug)", () => {
    const result = formErrorsFromProblem(
      problem({ code: "conflict", status: 409, field: "code" }),
      409,
      fields,
    );
    expect(result.fields).toEqual({ code: { key: "errors.code.conflict" } });
    expect(result.other).toEqual([]);
  });

  it("explains a 409 on no field of the form in the summary", () => {
    const result = formErrorsFromProblem(
      problem({ code: "conflict", status: 409, field: "other" }),
      409,
      fields,
    );
    expect(result.other).toEqual([{ key: "errors.code.conflict" }]);
    const rule = formErrorsFromProblem(
      problem({ code: "rule_violation", status: 409, rule: "input_type_immutable" }),
      409,
      fields,
    );
    expect(rule.other).toEqual([{ key: "errors.reason.input_type_immutable" }]);
    const inUse = formErrorsFromProblem(problem({ code: "in_use", status: 409 }), 409, fields);
    expect(inUse.other).toEqual([{ key: "errors.code.in_use" }]);
  });

  it("gives a 413 its own message and a 403 the forbidden message", () => {
    expect(
      formErrorsFromProblem(problem({ code: "validation_failed", status: 413 }), 413, fields).other,
    ).toEqual([{ key: "errors.payloadTooLarge" }]);
    expect(
      formErrorsFromProblem(problem({ code: "forbidden", status: 403 }), 403, fields).other,
    ).toEqual([{ key: "errors.code.forbidden" }]);
  });

  it("never carries the English detail", () => {
    const result = formErrorsFromProblem(
      problem({ code: "internal_error", status: 500 }),
      500,
      fields,
    );
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});

describe("summaryOf", () => {
  it("asks the admin to check the marked fields when there are field errors, then lists the rest", () => {
    expect(summaryOf({ "name.uk": { key: "x" } }, [])).toEqual([{ key: "dict.form.checkFields" }]);
    expect(summaryOf({ "name.uk": { key: "x" } }, [{ key: "errors.code.conflict" }])).toEqual([
      { key: "dict.form.checkFields" },
      { key: "errors.code.conflict" },
    ]);
    expect(summaryOf({}, [{ key: "errors.code.in_use" }])).toEqual([{ key: "errors.code.in_use" }]);
    expect(summaryOf({}, [])).toEqual([]);
  });
});

describe("stateAfterOutcome", () => {
  it("is idle after a success, with no leftover error", () => {
    expect(stateAfterOutcome({ kind: "ok", status: 200, data: {} }, fields)).toEqual(IDLE_SUBMIT);
    expect(stateAfterOutcome({ kind: "aborted" }, fields)).toEqual(IDLE_SUBMIT);
    expect(IDLE_SUBMIT.busy).toBe(false);
  });

  it("shows the API's answer on the fields and in the summary, keeping the status for the 409 hint", () => {
    const state = stateAfterOutcome(
      {
        kind: "problem",
        status: 400,
        retryAfter: null,
        problem: problem({
          code: "validation_failed",
          status: 400,
          errors: [{ path: "name.uk", code: "default_locale_missing" }],
        }),
      },
      fields,
    );
    expect(state.busy).toBe(false);
    expect(state.fieldErrors).toEqual({
      "name.uk": { key: "errors.reason.default_locale_missing" },
    });
    expect(state.summary).toEqual([{ key: "dict.form.checkFields" }]);
    expect(state.status).toBe(400);
    expect(state.unknown).toBe(false);
  });

  it("explains a 409 in the summary and keeps its status", () => {
    const state = stateAfterOutcome(
      {
        kind: "problem",
        status: 409,
        retryAfter: null,
        problem: problem({ code: "in_use", status: 409 }),
      },
      [],
    );
    expect(state.summary).toEqual([{ key: "errors.code.in_use" }]);
    expect(state.status).toBe(409);
  });

  it("says the result is unknown for a lost answer, with no error shown as if the server had refused", () => {
    const state = stateAfterOutcome({ kind: "unknown", failure: { kind: "timeout" } }, fields);
    expect(state.unknown).toBe(true);
    expect(state.summary).toEqual([]);
    expect(state.fieldErrors).toEqual({});
    expect(state.busy).toBe(false);
  });
});

describe("stateWithIssues", () => {
  it("is the local check failing: the fields marked, the summary asking to check them, nothing busy", () => {
    const state = stateWithIssues({ code: { key: "dict.error.codeFormat" } });
    expect(state.fieldErrors).toEqual({ code: { key: "dict.error.codeFormat" } });
    expect(state.summary).toEqual([{ key: "dict.form.checkFields" }]);
    expect(state.busy).toBe(false);
    expect(state.status).toBeNull();
  });
});
