import { describe, expect, it } from "vitest";
import { parseResendEnv, ResendConfigError } from "./config.js";

const KEY = "re_Config_0123456789abcdefXYZ";

function messageOf(env: Record<string, string | undefined>): string {
  try {
    parseResendEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ResendConfigError);
    return (error as Error).message;
  }
  throw new Error("expected parseResendEnv to throw");
}

describe("RESEND_API_KEY", () => {
  it("takes re_ followed by 16 to 256 visible ASCII characters, trimmed", () => {
    expect(parseResendEnv({ RESEND_API_KEY: KEY })).toEqual({ apiKey: KEY });
    expect(parseResendEnv({ RESEND_API_KEY: `  ${KEY}\n` })).toEqual({ apiKey: KEY });
    const shortest = `re_${"a".repeat(16)}`;
    const longest = `re_${"Z".repeat(256)}`;
    expect(parseResendEnv({ RESEND_API_KEY: shortest }).apiKey).toBe(shortest);
    expect(parseResendEnv({ RESEND_API_KEY: longest }).apiKey).toBe(longest);
  });

  it("is required, and the error names the variable", () => {
    for (const value of [undefined, "", "   "]) {
      expect(messageOf({ RESEND_API_KEY: value })).toMatch(
        /^RESEND_API_KEY is required when EMAIL_PROVIDER=resend/,
      );
    }
  });

  it("refuses what cannot be a key, without showing the value or a part of it", () => {
    const bad = [
      "rk_live_0123456789abcdefghij", // another service's prefix
      "0123456789abcdef0123", // no prefix
      "RE_0123456789abcdef0123", // the prefix is lower case
      `re_${"a".repeat(15)}`, // too short
      `re_${"a".repeat(257)}`, // too long
      "re_0123456789 abcdef0123", // a space inside
      "re_0123456789abcdef0123é", // not ASCII
      "re_0123456789abcdef0123\u0000", // a control character
      "Bearer re_0123456789abcdef0123", // a pasted header
    ];
    for (const value of bad) {
      // One fixed sentence for every bad value: nothing of the value can be in it.
      expect(messageOf({ RESEND_API_KEY: value })).toBe(
        "RESEND_API_KEY must be re_ followed by 16 to 256 visible ASCII characters without spaces (the value is not shown).",
      );
    }
  });
});
