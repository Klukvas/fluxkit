import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashSessionToken } from "../auth/session-token.js";
import { accessTokenMatches, deriveAccessToken, hmacSha256 } from "./access-token.js";

const SECRET = "a-test-secret-of-at-least-32-characters!";
const ORDER_ID = "0b6f8d3e-1c2a-4d5e-9f10-a1b2c3d4e5f6";
const KEY = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

describe("hmacSha256", () => {
  it("is HMAC-SHA256 (RFC 4231, test case 2)", () => {
    const mac = hmacSha256("Jefe", "what do ya want for nothing?");
    expect(Buffer.from(mac).toString("hex")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
});

describe("deriveAccessToken", () => {
  it("is the HMAC-SHA256 of the order and the key in base64url, and only its SHA-256 is meant to be stored", () => {
    const issued = deriveAccessToken(SECRET, ORDER_ID, KEY);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.hash).toBe(hashSessionToken(issued.token));
    expect(issued.hash).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHmac("sha256", SECRET)
      .update(`fluxkit:order-access-token:v1\n${ORDER_ID}\n${KEY}`)
      .digest("base64url");
    expect(issued.token).toBe(expected);
  });

  it("repeats for the same input and differs for another order, key or secret", () => {
    const base = deriveAccessToken(SECRET, ORDER_ID, KEY);
    expect(deriveAccessToken(SECRET, ORDER_ID, KEY)).toEqual(base);
    const others = [
      deriveAccessToken(SECRET, ORDER_ID.replace(/6$/, "7"), KEY),
      deriveAccessToken(SECRET, ORDER_ID, KEY.replace(/f$/, "e")),
      deriveAccessToken(`${SECRET}x`, ORDER_ID, KEY),
    ];
    expect(new Set([base.token, ...others.map((other) => other.token)]).size).toBe(4);
  });

  it("refuses a short or empty secret loudly", () => {
    expect(() => deriveAccessToken("", ORDER_ID, KEY)).toThrow(RangeError);
    expect(() => deriveAccessToken("x".repeat(31), ORDER_ID, KEY)).toThrow(RangeError);
  });
});

describe("accessTokenMatches", () => {
  const issued = deriveAccessToken(SECRET, ORDER_ID, KEY);

  it("accepts the token whose hash is stored", () => {
    expect(accessTokenMatches(issued.token, issued.hash)).toBe(true);
  });

  it("refuses another token, a changed character and the hash itself", () => {
    expect(
      accessTokenMatches(deriveAccessToken(SECRET, ORDER_ID, "other-key").token, issued.hash),
    ).toBe(false);
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
