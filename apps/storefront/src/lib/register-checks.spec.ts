import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, registerFieldChecks } from "./register-checks";

const ok = { email: "shopper@example.com", password: "a long enough pass" };
const codes = (values: { email: string; password: string }) =>
  registerFieldChecks(values)?.fieldErrors.map(({ path, code, messageKey }) => ({
    path,
    code,
    messageKey,
  })) ?? [];

describe("registerFieldChecks (review D-06: 'bad' and a 5-character password passed the first submit)", () => {
  it("passes a well-formed email and a password of 12 to 128 characters", () => {
    expect(registerFieldChecks(ok)).toBeNull();
    expect(registerFieldChecks({ ...ok, password: "x".repeat(12) })).toBeNull();
    expect(registerFieldChecks({ ...ok, password: "x".repeat(128) })).toBeNull();
    expect(registerFieldChecks({ ...ok, email: "  Shopper@Example.COM " })).toBeNull();
  });

  it("flags the email and the password together, each with its own friendly message", () => {
    expect(codes({ email: "bad", password: "short" })).toEqual([
      { path: "email", code: "invalid_format", messageKey: "account.register.error.email" },
      {
        path: "password",
        code: "too_short",
        messageKey: "account.register.error.passwordShort",
      },
    ]);
    expect(registerFieldChecks({ email: "bad", password: "short" })?.messageKey).toBe(
      "errors.validation_failed",
    );
  });

  it.each([
    "a@b",
    "@example.com",
    "a@.com",
    "a@example.",
    "a@exa..mple.com",
    "a b@example.com",
    "a@b@c.com",
  ])("refuses the email %j (the API's shape check)", (email) => {
    expect(codes({ ...ok, email })).toEqual([
      { path: "email", code: "invalid_format", messageKey: "account.register.error.email" },
    ]);
  });

  it("counts code points like the API (an emoji is one character) and refuses more than 128", () => {
    expect(codes({ ...ok, password: "😀".repeat(11) })).toHaveLength(1);
    expect(codes({ ...ok, password: "x".repeat(129) })).toEqual([
      { path: "password", code: "too_long", messageKey: "account.register.error.passwordLong" },
    ]);
  });

  it("refuses the email as the password", () => {
    expect(
      codes({ email: "longer.name@example.com", password: " Longer.Name@example.com" }),
    ).toEqual([
      { path: "password", code: "equals_email", messageKey: "errors.field.equals_email" },
    ]);
  });

  it("leaves blank fields to the required check (one message per field)", () => {
    expect(registerFieldChecks({ email: "", password: "" })).toBeNull();
  });

  it("uses the API's limits (core PASSWORD_LIMITS; the storefront does not import core)", () => {
    const core = readFileSync(
      new URL("../../../../packages/core/src/auth/password-policy.ts", import.meta.url),
      "utf8",
    );
    expect(core).toContain(
      `PASSWORD_LIMITS = Object.freeze({ minLength: ${String(PASSWORD_MIN_LENGTH)}, maxLength: ${String(PASSWORD_MAX_LENGTH)} })`,
    );
  });
});
