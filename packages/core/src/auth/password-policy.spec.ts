import { describe, expect, it } from "vitest";
import { PASSWORD_LIMITS, validatePassword } from "./password-policy.js";

const email = "Admin@Example.com";
const codes = (password: unknown, mail: string = email) => {
  const result = validatePassword(password as string, { email: mail });
  return result.ok ? [] : result.errors.map((error) => error.code);
};

describe("validatePassword", () => {
  it("exports the limits", () => {
    expect(PASSWORD_LIMITS).toEqual({ minLength: 12, maxLength: 128 });
  });

  it("accepts 12 and 128 characters, rejects 11 and 129", () => {
    expect(validatePassword("a".repeat(12), { email })).toEqual({ ok: true });
    expect(validatePassword("a".repeat(128), { email })).toEqual({ ok: true });
    expect(codes("a".repeat(11))).toEqual(["too_short"]);
    expect(codes("a".repeat(129))).toEqual(["too_long"]);
    expect(codes("")).toEqual(["too_short"]);
  });

  it("counts code points, not UTF-16 units", () => {
    // 6 emoji = 12 UTF-16 units but only 6 code points
    expect(codes("😀".repeat(6))).toEqual(["too_short"]);
    expect(validatePassword("😀".repeat(12), { email })).toEqual({ ok: true });
    // 128 emoji = 256 units but 128 code points: still fine; 129 is over the limit
    expect(validatePassword("😀".repeat(128), { email })).toEqual({ ok: true });
    expect(codes("😀".repeat(129))).toEqual(["too_long"]);
  });

  it("counts Ukrainian text by code points", () => {
    expect(validatePassword("пароль-довгий", { email })).toEqual({ ok: true });
    expect(codes("пароль-коро")).toEqual(["too_short"]);
  });

  it("has no composition rules", () => {
    expect(validatePassword("aaaaaaaaaaaa", { email })).toEqual({ ok: true });
    expect(validatePassword("123456789012", { email })).toEqual({ ok: true });
    expect(validatePassword("            ", { email })).toEqual({ ok: true });
  });

  it("rejects a password equal to the email, case-insensitively", () => {
    expect(codes("admin@example.com")).toEqual(["equals_email"]);
    expect(codes("ADMIN@EXAMPLE.COM")).toEqual(["equals_email"]);
    expect(codes("admin@example.com", "  Admin@Example.com ")).toEqual(["equals_email"]);
    expect(validatePassword("admin@example.com!", { email })).toEqual({ ok: true });
  });

  it("rejects NUL anywhere", () => {
    expect(codes("a".repeat(12) + "\u0000")).toEqual(["contains_nul"]);
    expect(codes("\u0000" + "a".repeat(12))).toEqual(["contains_nul"]);
  });

  it("rejects non-strings with a single error", () => {
    for (const value of [undefined, null, 123456789012, {}, [], ["a".repeat(12)]]) {
      expect(codes(value)).toEqual(["not_a_string"]);
    }
  });

  it("reports every failing rule", () => {
    expect(codes("a\u0000")).toEqual(["too_short", "contains_nul"]);
  });

  it("does not throw on a non-string email option", () => {
    expect(validatePassword("a".repeat(12), { email: undefined as unknown as string })).toEqual({
      ok: true,
    });
  });
});
