import { describe, expect, it } from "vitest";
import { forgotPasswordHref } from "./email-links";

describe("forgotPasswordHref", () => {
  it("is the locale's forgot-password page when the shop sends email", () => {
    expect(forgotPasswordHref("uk", true)).toBe("/uk/account/forgot-password");
    expect(forgotPasswordHref("en", true)).toBe("/en/account/forgot-password");
  });

  it("is undefined (no link at all) when the shop sends no email", () => {
    expect(forgotPasswordHref("uk", false)).toBeUndefined();
    expect(forgotPasswordHref("en", false)).toBeUndefined();
  });
});
