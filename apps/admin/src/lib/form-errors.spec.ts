import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { fieldErrorsFromProblem } from "./form-errors";

const problem = (
  errors: ProblemDetails["errors"],
  code: ProblemDetails["code"] = "validation_failed",
) =>
  ({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    code,
    detail: "SECRET",
    ...(errors === undefined ? {} : { errors }),
  }) satisfies ProblemDetails;

describe("fieldErrorsFromProblem", () => {
  it("puts each errors[] entry on the field its path names, first error per field", () => {
    const result = fieldErrorsFromProblem(
      problem([
        { path: "newPassword", code: "too_short" },
        { path: "newPassword", code: "equals_email" },
        { path: "currentPassword", code: "incorrect" },
      ]),
      ["currentPassword", "newPassword"],
    );
    expect(result.fields).toEqual({
      newPassword: { key: "errors.reason.too_short" },
      currentPassword: { key: "errors.reason.incorrect" },
    });
    expect(result.other).toEqual([]);
  });

  it("keeps errors of unknown paths and unknown codes visible in the summary, with the code", () => {
    const result = fieldErrorsFromProblem(
      problem([
        { path: "somethingElse", code: "unknown_field" },
        { path: "newPassword", code: "brand_new" },
      ]),
      ["newPassword"],
    );
    expect(result.fields).toEqual({ newPassword: { key: "errors.generic", code: "brand_new" } });
    expect(result.other).toEqual([{ key: "errors.reason.unknown_field" }]);
  });

  it("describes a problem without errors[] by its code", () => {
    expect(fieldErrorsFromProblem(problem(undefined, "conflict"), ["x"]).other).toEqual([
      { key: "errors.code.conflict" },
    ]);
  });
});
