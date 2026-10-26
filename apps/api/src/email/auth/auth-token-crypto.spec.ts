import { createHash, createHmac } from "node:crypto";
import { CUSTOMER_AUTH_TOKEN_LABEL } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { authTokenHashesMatch, deriveAuthToken, hashAuthToken } from "./auth-token-crypto.js";

const SECRET = "test-order-token-secret-0123456789-abcdef";
const TOKEN_ID = "6f1c1a52-8f3e-4a8b-9d0e-1c2b3a4d5e6f";

describe("customer auth token crypto (ADR 0031 decision 9)", () => {
  it("derives base64url(HMAC-SHA256(secret, label + purpose + id)) with 256 bits", () => {
    const expected = createHmac("sha256", SECRET)
      .update(`${CUSTOMER_AUTH_TOKEN_LABEL}\npassword_reset\n${TOKEN_ID}`)
      .digest("base64url");
    const token = deriveAuthToken(SECRET, "password_reset", TOKEN_ID);
    expect(token).toBe(expected);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("gives another token for another purpose, id or secret (no reuse across kinds of link)", () => {
    const base = deriveAuthToken(SECRET, "password_reset", TOKEN_ID);
    expect(deriveAuthToken(SECRET, "email_verification", TOKEN_ID)).not.toBe(base);
    expect(deriveAuthToken(SECRET, "password_reset", TOKEN_ID.replace("6f", "7f"))).not.toBe(base);
    expect(deriveAuthToken(`${SECRET}x`, "password_reset", TOKEN_ID)).not.toBe(base);
    // 1 000 random ids give 1 000 distinct tokens.
    const tokens = new Set(
      Array.from({ length: 1_000 }, () =>
        deriveAuthToken(SECRET, "password_reset", crypto.randomUUID()),
      ),
    );
    expect(tokens.size).toBe(1_000);
  });

  it("refuses a short secret instead of deriving a weak token", () => {
    expect(() => deriveAuthToken("short", "password_reset", TOKEN_ID)).toThrow(RangeError);
  });

  it("stores SHA-256 hex of the token, and compares two hashes in constant time", () => {
    const token = deriveAuthToken(SECRET, "password_reset", TOKEN_ID);
    const hash = hashAuthToken(token);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(authTokenHashesMatch(hash, hash)).toBe(true);
    expect(authTokenHashesMatch(hash, hashAuthToken(`${token}x`))).toBe(false);
    expect(authTokenHashesMatch(hash, hash.toUpperCase())).toBe(false);
    expect(authTokenHashesMatch(hash, hash.slice(0, 63))).toBe(false);
    expect(authTokenHashesMatch("", "")).toBe(false);
  });
});
