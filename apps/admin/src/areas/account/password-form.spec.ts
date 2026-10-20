import { PASSWORD_LIMITS as CORE_LIMITS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { PASSWORD_LIMITS, isPasswordFormDirty, localPasswordErrors } from "./password-form";

const empty = { currentPassword: "", newPassword: "", repeatPassword: "" };

describe("password form", () => {
  it("uses the policy limits of core (copied: core is not bundled)", () => {
    expect(PASSWORD_LIMITS).toEqual({ ...CORE_LIMITS });
  });

  it("refuses a repeated password that differs, and nothing else", () => {
    expect(localPasswordErrors({ ...empty, newPassword: "a", repeatPassword: "b" })).toEqual({
      repeatPassword: { key: "account.password.mismatch" },
    });
    expect(
      localPasswordErrors({ ...empty, newPassword: "short", repeatPassword: "short" }),
    ).toEqual({});
  });

  it("is dirty as soon as any field holds input", () => {
    expect(isPasswordFormDirty(empty)).toBe(false);
    expect(isPasswordFormDirty({ ...empty, currentPassword: "x" })).toBe(true);
    expect(isPasswordFormDirty({ ...empty, repeatPassword: "x" })).toBe(true);
  });
});
