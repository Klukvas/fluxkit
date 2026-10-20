import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  EMPTY_CREATE_VALUES,
  createBody,
  createErrorsFromProblem,
  createFormErrors,
  isCreateDirty,
  resetErrorsFromProblem,
  resetFormErrors,
  sameEmail,
} from "./user-form";

function problem(overrides: Partial<ProblemDetails>): ProblemDetails {
  return {
    type: "about:blank",
    title: "x",
    status: 400,
    code: "validation_failed",
    detail: "English text that is never shown",
    ...overrides,
  };
}

const good = { email: "anna@example.com", role: "manager" as const, password: "a".repeat(12) };

describe("the create form", () => {
  it("starts empty with the least powerful role chosen", () => {
    expect(EMPTY_CREATE_VALUES).toEqual({ email: "", role: "viewer", password: "" });
    expect(isCreateDirty(EMPTY_CREATE_VALUES)).toBe(false);
    expect(isCreateDirty({ ...EMPTY_CREATE_VALUES, email: "a" })).toBe(true);
    expect(isCreateDirty({ ...EMPTY_CREATE_VALUES, password: "a" })).toBe(true);
    expect(isCreateDirty({ ...EMPTY_CREATE_VALUES, role: "owner" })).toBe(true);
  });

  it("accepts a filled form and sends exactly email, role and password, the email trimmed", () => {
    expect(createFormErrors(good)).toEqual({});
    expect(createBody({ ...good, email: "  Anna@Example.com " })).toEqual({
      email: "Anna@Example.com",
      role: "manager",
      password: "a".repeat(12),
    });
    expect(Object.keys(createBody(good)).sort()).toEqual(["email", "password", "role"]);
  });

  it("refuses an empty or too long email before sending", () => {
    expect(createFormErrors({ ...good, email: "   " })).toEqual({
      email: { key: "errors.reason.required" },
    });
    expect(createFormErrors({ ...good, email: `${"a".repeat(243)}@example.com` })).toEqual({
      email: { key: "errors.reason.too_long" },
    });
  });

  it("refuses a password that breaks the policy, with core's reason on the password field", () => {
    expect(createFormErrors({ ...good, password: "short" })).toEqual({
      password: { key: "errors.reason.too_short" },
    });
    expect(createFormErrors({ ...good, password: "a".repeat(129) })).toEqual({
      password: { key: "errors.reason.too_long" },
    });
    expect(
      createFormErrors({ ...good, email: "Anna@Example.com", password: " anna@example.com" }),
    ).toEqual({
      password: { key: "errors.reason.equals_email" },
    });
    expect(createFormErrors({ ...good, password: `${"a".repeat(12)}\u0000` })).toEqual({
      password: { key: "errors.reason.contains_nul" },
    });
  });

  it("puts a duplicate email (409 conflict on field email) on the email field", () => {
    const mapped = createErrorsFromProblem(
      409,
      problem({
        status: 409,
        code: "conflict",
        field: "email",
        constraint: "admin_user_email_key",
      }),
    );
    expect(mapped).toEqual({ fields: { email: { key: "user.create.emailTaken" } }, other: [] });
  });

  it("puts the API's 400 errors on their fields and anything else in the summary", () => {
    const mapped = createErrorsFromProblem(
      400,
      problem({
        errors: [
          { path: "email", code: "invalid_format", message: "x" },
          { path: "password", code: "too_short", message: "x" },
          { path: "nickname", code: "unknown_field", message: "x" },
        ],
      }),
    );
    expect(mapped.fields).toEqual({
      email: { key: "errors.reason.invalid_format" },
      password: { key: "errors.reason.too_short" },
    });
    expect(mapped.other).toEqual([{ key: "errors.reason.unknown_field" }]);
    const other = createErrorsFromProblem(409, problem({ status: 409, code: "conflict" }));
    expect(other).toEqual({ fields: {}, other: [{ key: "errors.code.conflict" }] });
  });
});

describe("the reset form", () => {
  it("checks the new password against the target user's email", () => {
    expect(resetFormErrors("a".repeat(12), "anna@example.com")).toEqual({});
    expect(resetFormErrors("", "anna@example.com")).toEqual({
      newPassword: { key: "errors.reason.too_short" },
    });
    expect(resetFormErrors("ANNA@example.com", "anna@example.com")).toEqual({
      newPassword: { key: "errors.reason.equals_email" },
    });
  });

  it("puts the API's policy errors on the new password field", () => {
    const mapped = resetErrorsFromProblem(
      400,
      problem({ errors: [{ path: "newPassword", code: "equals_email", message: "x" }] }),
    );
    expect(mapped).toEqual({
      fields: { newPassword: { key: "errors.reason.equals_email" } },
      other: [],
    });
  });
});

describe("emails compared as the API stores them", () => {
  it("ignores surrounding spaces and case", () => {
    expect(sameEmail("  Anna@Example.com ", "anna@example.com")).toBe(true);
    expect(sameEmail("anna@example.com", "anna@example.org")).toBe(false);
  });
});
