import { describe, expect, it } from "vitest";
import {
  deriveGuestAccessToken,
  GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH,
  type HmacSha256,
} from "./access-token.js";

/**
 * A deterministic stand-in for HMAC-SHA256 (core has no crypto): 32 bytes that depend on the key AND the message, so the
 * spec can see what core feeds the port. The real HMAC is covered in apps/api against node:crypto and a published vector.
 */
const fakeHmac: HmacSha256 = (key, message) => {
  const bytes = new Uint8Array(32);
  const text = `${key}\u0000${message}`;
  for (let index = 0; index < text.length; index += 1) {
    const slot = index % 32;
    bytes[slot] = ((bytes[slot] ?? 0) * 31 + text.charCodeAt(index)) & 0xff;
  }
  return bytes;
};

const SECRET = "s".repeat(GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH);
const ORDER_ID = "0b6f8d3e-1c2a-4d5e-9f10-a1b2c3d4e5f6";
const KEY = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const input = { secret: SECRET, orderId: ORDER_ID, idempotencyKey: KEY };

describe("deriveGuestAccessToken", () => {
  it("is 32 bytes in unpadded base64url (43 characters)", () => {
    expect(deriveGuestAccessToken(input, fakeHmac)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is deterministic: the same secret, order and key give the same token every time", () => {
    const first = deriveGuestAccessToken(input, fakeHmac);
    for (let round = 0; round < 5; round += 1) {
      expect(deriveGuestAccessToken({ ...input }, fakeHmac)).toBe(first);
    }
  });

  it("differs per secret, per order and per idempotency key", () => {
    const base = deriveGuestAccessToken(input, fakeHmac);
    const otherSecret = deriveGuestAccessToken({ ...input, secret: "t".repeat(32) }, fakeHmac);
    const otherOrder = deriveGuestAccessToken(
      { ...input, orderId: "0b6f8d3e-1c2a-4d5e-9f10-a1b2c3d4e5f7" },
      fakeHmac,
    );
    const otherKey = deriveGuestAccessToken(
      { ...input, idempotencyKey: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e50" },
      fakeHmac,
    );
    expect(new Set([base, otherSecret, otherOrder, otherKey]).size).toBe(4);
  });

  it("does not let the order id and the key trade characters (the two fields are separated)", () => {
    const one = deriveGuestAccessToken({ ...input, orderId: "ab", idempotencyKey: "cd" }, fakeHmac);
    const two = deriveGuestAccessToken({ ...input, orderId: "abc", idempotencyKey: "d" }, fakeHmac);
    expect(one).not.toBe(two);
  });

  it("hands the secret to the port as the key and never inside the message", () => {
    const seen: { key: string; message: string }[] = [];
    deriveGuestAccessToken(input, (key, message) => {
      seen.push({ key, message });
      return fakeHmac(key, message);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.key).toBe(SECRET);
    expect(seen[0]?.message).not.toContain(SECRET);
    expect(seen[0]?.message).toContain(ORDER_ID);
    expect(seen[0]?.message).toContain(KEY);
  });

  it.each([
    ["an empty secret", ""],
    ["a secret one character too short", "s".repeat(GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH - 1)],
  ])("rejects %s as a RangeError (a misconfiguration, never a weak token)", (_name, secret) => {
    expect(() => deriveGuestAccessToken({ ...input, secret }, fakeHmac)).toThrow(RangeError);
  });

  it("accepts a secret of exactly the minimum length", () => {
    expect(() => deriveGuestAccessToken(input, fakeHmac)).not.toThrow();
  });

  it.each([
    ["an empty order id", { orderId: "" }],
    ["an empty idempotency key", { idempotencyKey: "" }],
    ["an order id with a line break", { orderId: "a\nb" }],
    ["a key with a line break", { idempotencyKey: "a\nb" }],
  ])("rejects %s as a RangeError", (_name, change) => {
    expect(() => deriveGuestAccessToken({ ...input, ...change }, fakeHmac)).toThrow(RangeError);
  });

  it("rejects a port that does not return 32 bytes", () => {
    expect(() => deriveGuestAccessToken(input, () => new Uint8Array(16))).toThrow(RangeError);
  });

  it("covers every byte value in the base64url encoding", () => {
    const all: HmacSha256 = () => Uint8Array.from({ length: 32 }, (_, index) => 255 - index * 8);
    const token = deriveGuestAccessToken(input, all);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ones: HmacSha256 = () => new Uint8Array(32).fill(0xff);
    expect(deriveGuestAccessToken(input, ones)).toBe(`${"_".repeat(42)}8`);
    const zeros: HmacSha256 = () => new Uint8Array(32);
    expect(deriveGuestAccessToken(input, zeros)).toBe("A".repeat(43));
  });
});
