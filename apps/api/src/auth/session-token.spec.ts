import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
  readTokenCookie,
  SESSION_TOKEN_PATTERN,
} from "./session-token.js";

describe("session tokens (shared by admin and customer sessions)", () => {
  it("generates 32 random bytes as 43 base64url characters, different every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(SESSION_TOKEN_PATTERN);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("hashes with SHA-256 hex of the token text and never returns the token", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "short",
    "A".repeat(44),
    `${"A".repeat(42)}=`,
    "A".repeat(42) + "+",
  ])("does not accept %j as a well-formed token", (value) => {
    expect(isWellFormedSessionToken(value)).toBe(false);
  });

  it("readTokenCookie reads only the exact cookie name", () => {
    const token = "A".repeat(43);
    expect(readTokenCookie(`a=b; mine=${token}`, "mine")).toBe(token);
    expect(readTokenCookie(`xmine=${token}; mine2=${token}`, "mine")).toBeUndefined();
    expect(readTokenCookie(undefined, "mine")).toBeUndefined();
  });
});
