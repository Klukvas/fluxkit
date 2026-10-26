import { describe, expect, it } from "vitest";
import { checkNewPasswords } from "./reset-password-form";

describe("checkNewPasswords", () => {
  it("accepts two equal passwords (the API judges length and the rest)", () => {
    expect(
      checkNewPasswords({
        newPassword: "a long new password",
        confirmPassword: "a long new password",
      }),
    ).toBeNull();
    expect(checkNewPasswords({ newPassword: "x", confirmPassword: "x" })).toBeNull();
  });

  it("reports a mismatch as a field error on the repeat field, with the form's own message key", () => {
    const failure = checkNewPasswords({
      newPassword: "a long new password",
      confirmPassword: "a long new passwor",
    });
    expect(failure?.fieldErrors).toEqual([
      { path: "confirmPassword", code: "mismatch", messageKey: "account.reset.mismatch" },
    ]);
    expect(failure?.status).toBeNull();
  });

  it("compares exactly: case and surrounding spaces count (they are part of a password)", () => {
    expect(
      checkNewPasswords({ newPassword: "Abc def ghi jkl", confirmPassword: "abc def ghi jkl" }),
    ).not.toBeNull();
    expect(
      checkNewPasswords({ newPassword: "abc def ghi jkl", confirmPassword: "abc def ghi jkl " }),
    ).not.toBeNull();
  });
});
