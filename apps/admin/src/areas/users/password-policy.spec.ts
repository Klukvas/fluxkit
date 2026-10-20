import { PASSWORD_LIMITS as CORE_LIMITS, validatePassword } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { PASSWORD_LIMITS } from "../account/password-form";
import { passwordFeedback, passwordLength, passwordProblems } from "./password-policy";

const email = "Anna@Example.com";

/** Core's verdict as a list of codes, the way the API reports it under `password` / `newPassword`. */
function core(password: string, mail = email): string[] {
  const result = validatePassword(password, { email: mail });
  return result.ok ? [] : result.errors.map((error) => error.code);
}

/** Many passwords around the edges of every rule: lengths 0 to 140, emoji, Ukrainian, spaces, NUL, the email. */
function samples(): string[] {
  const list: string[] = [];
  for (let length = 0; length <= 140; length += 1) {
    list.push("a".repeat(length), "😀".repeat(length), "ї".repeat(length), " ".repeat(length));
  }
  for (const base of [
    email,
    email.toLowerCase(),
    email.toUpperCase(),
    `  ${email} `,
    `${email}!`,
  ]) {
    list.push(base, `${base}\u0000`, `\u0000${base}`);
  }
  list.push(
    "a".repeat(12) + "\u0000",
    "a\u0000",
    "\u0000".repeat(12),
    "пароль-довгий",
    "пароль-коро",
  );
  return list;
}

describe("the password policy the users area checks before sending", () => {
  it("takes its limits from the account area, which compares them with core", () => {
    expect(PASSWORD_LIMITS).toEqual({ ...CORE_LIMITS });
  });

  it("finds exactly core's problems, in core's order, for every sample", () => {
    for (const password of samples()) {
      expect(passwordProblems(password, email), JSON.stringify(password)).toEqual(core(password));
    }
  });

  it("compares with the email as core does: trimmed and case-insensitive, on both sides", () => {
    expect(passwordProblems("anna@example.com", "  ANNA@example.com ")).toEqual(
      core("anna@example.com", "  ANNA@example.com "),
    );
    expect(passwordProblems(" ANNA@EXAMPLE.COM ", email)).toEqual(["equals_email"]);
    // An empty email (not typed yet) never matches a password of 12 characters or more.
    expect(passwordProblems("a".repeat(12), "")).toEqual([]);
  });

  it("counts characters as code points, as core does (an emoji is one)", () => {
    expect(passwordLength("😀".repeat(6))).toBe(6);
    expect(passwordProblems("😀".repeat(11), email)).toEqual(["too_short"]);
    expect(passwordProblems("😀".repeat(12), email)).toEqual([]);
  });

  it("has no composition rules: twelve spaces or twelve digits are accepted", () => {
    expect(passwordProblems(" ".repeat(12), email)).toEqual([]);
    expect(passwordProblems("123456789012", email)).toEqual([]);
  });
});

describe("live feedback while typing", () => {
  it("states the length rule with the count, and each rule as met or not", () => {
    expect(passwordFeedback("", email)).toEqual({
      length: 0,
      min: 12,
      max: 128,
      rules: [
        { id: "length", met: false },
        { id: "notEmail", met: true },
      ],
    });
    expect(passwordFeedback("a".repeat(12), email).rules).toEqual([
      { id: "length", met: true },
      { id: "notEmail", met: true },
    ]);
    expect(passwordFeedback("a".repeat(129), email).rules[0]).toEqual({ id: "length", met: false });
    expect(passwordFeedback(email.toLowerCase(), email).rules).toEqual([
      { id: "length", met: true },
      { id: "notEmail", met: false },
    ]);
  });

  it("is all met exactly when core accepts the password (NUL counts though it is not listed)", () => {
    for (const password of samples()) {
      const feedback = passwordFeedback(password, email);
      const allMet = feedback.rules.every((rule) => rule.met) && !password.includes("\u0000");
      expect(allMet, JSON.stringify(password)).toBe(core(password).length === 0);
    }
  });
});
