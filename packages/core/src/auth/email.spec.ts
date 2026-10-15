import { describe, expect, it } from "vitest";
import { normalizeEmail, validateEmail } from "./email.js";

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Admin@Example.COM \n")).toBe("admin@example.com");
  });

  it("is idempotent", () => {
    const once = normalizeEmail(" A@B.Co ");
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe("validateEmail", () => {
  it("accepts ordinary addresses and returns the normalized value", () => {
    expect(validateEmail(" Owner@Shop.Example.com ")).toEqual({
      ok: true,
      email: "owner@shop.example.com",
    });
    expect(validateEmail("a+tag@b.co")).toEqual({ ok: true, email: "a+tag@b.co" });
    expect(validateEmail("user@пошта.укр")).toEqual({ ok: true, email: "user@пошта.укр" });
  });

  it("rejects non-strings", () => {
    for (const value of [undefined, null, 1, {}, ["a@b.co"]]) {
      expect(validateEmail(value as string)).toEqual({ ok: false, reason: "not_a_string" });
    }
  });

  it("rejects empty and blank input", () => {
    expect(validateEmail("")).toEqual({ ok: false, reason: "empty" });
    expect(validateEmail("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("limits the length to 254", () => {
    const local = "a".repeat(254 - "@b.co".length);
    expect(validateEmail(`${local}@b.co`).ok).toBe(true);
    expect(validateEmail(`${local}a@b.co`)).toEqual({ ok: false, reason: "too_long" });
  });

  it("rejects malformed addresses", () => {
    for (const value of [
      "plain",
      "@b.co",
      "a@",
      "a@@b.co",
      "a@b@c.co",
      "a@b",
      "a@.b.co",
      "a@b.co.",
      "a@b..co",
      "a b@c.co",
      "a@b c.co",
      "a\t@b.co",
      "a@b.co\u0000",
      "a\u0007@b.co",
      "a\u007f@b.co",
      `a${String.fromCodePoint(0x2003)}b@c.co`,
      "a\nb@c.co",
    ]) {
      expect(validateEmail(value), JSON.stringify(value)).toEqual({
        ok: false,
        reason: "invalid_format",
      });
    }
  });
});
