import { describe, expect, it } from "vitest";
import { hashSessionToken } from "../auth/session-token.js";
import { issueAccessToken, accessTokenMatches } from "./access-token.js";

describe("issueAccessToken", () => {
  it("is 32 random bytes in base64url and only its SHA-256 is meant to be stored", () => {
    const issued = issueAccessToken();
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.hash).toBe(hashSessionToken(issued.token));
    expect(issued.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => issueAccessToken().token));
    expect(tokens.size).toBe(200);
  });
});

describe("accessTokenMatches", () => {
  const issued = issueAccessToken();

  it("accepts the token whose hash is stored", () => {
    expect(accessTokenMatches(issued.token, issued.hash)).toBe(true);
  });

  it("refuses another token, a changed character and the hash itself", () => {
    expect(accessTokenMatches(issueAccessToken().token, issued.hash)).toBe(false);
    const changed = `${issued.token.slice(0, 42)}${issued.token.endsWith("A") ? "B" : "A"}`;
    expect(accessTokenMatches(changed, issued.hash)).toBe(false);
    expect(accessTokenMatches(issued.hash, issued.hash)).toBe(false);
  });

  it("refuses without throwing when nothing is stored (unknown number, customer order) or the input is malformed", () => {
    expect(accessTokenMatches(issued.token, null)).toBe(false);
    expect(accessTokenMatches("", issued.hash)).toBe(false);
    expect(accessTokenMatches("x".repeat(10_000), issued.hash)).toBe(false);
    expect(accessTokenMatches(issued.token, "not a hash")).toBe(false);
  });
});
