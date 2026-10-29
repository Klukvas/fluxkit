import { describe, expect, it } from "vitest";
import { MONOBANK_API_ORIGIN, MonobankConfigError, parseMonobankEnv } from "./config.js";

const TOKEN = "uConfigSpecToken_0123456789abcdef";

function messageOf(env: Record<string, string | undefined>): string {
  try {
    parseMonobankEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(MonobankConfigError);
    return (error as Error).message;
  }
  throw new Error("expected parseMonobankEnv to throw");
}

describe("MONOBANK_TOKEN", () => {
  it("takes 20 to 256 visible ASCII characters, trimmed", () => {
    expect(parseMonobankEnv({ MONOBANK_TOKEN: TOKEN })).toEqual({ token: TOKEN });
    expect(parseMonobankEnv({ MONOBANK_TOKEN: `  ${TOKEN}\n` })).toEqual({ token: TOKEN });
    const shortest = "a".repeat(20);
    const longest = "Z".repeat(256);
    expect(parseMonobankEnv({ MONOBANK_TOKEN: shortest }).token).toBe(shortest);
    expect(parseMonobankEnv({ MONOBANK_TOKEN: longest }).token).toBe(longest);
  });

  it("is required, and the error names the variable", () => {
    for (const value of [undefined, "", "   "]) {
      expect(messageOf({ MONOBANK_TOKEN: value })).toBe(
        "MONOBANK_TOKEN is required when monobank is in PAYMENT_PROVIDERS_ENABLED. See .env.example.",
      );
    }
  });

  it("refuses what cannot be a token, with one fixed sentence that shows nothing of the value", () => {
    const bad = [
      "a".repeat(19), // too short
      "a".repeat(257), // too long
      "uToken 0123456789abcdefghij", // a space inside
      "uToken0123456789abcdefghijé", // not ASCII
      "uToken0123456789abcdefghij\u0000", // a control character
      "X-Token: uToken0123456789abcdef", // a pasted header
    ];
    for (const value of bad) {
      expect(messageOf({ MONOBANK_TOKEN: value })).toBe(
        "MONOBANK_TOKEN must be 20 to 256 visible ASCII characters without spaces (the value is not shown).",
      );
    }
  });

  it("has no URL variable: the origin is the constant https://api.monobank.ua", () => {
    expect(MONOBANK_API_ORIGIN).toBe("https://api.monobank.ua");
    expect(
      parseMonobankEnv({ MONOBANK_TOKEN: TOKEN, MONOBANK_API_URL: "https://evil.example" }),
    ).toEqual({ token: TOKEN });
  });
});
