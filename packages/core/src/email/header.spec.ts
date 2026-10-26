import { describe, expect, it } from "vitest";
import { hasHeaderUnsafeCharacter, sanitizeSubject, validateSubject } from "./header.js";
import { EMAIL_LIMITS } from "./limits.js";

// Characters that end, fold or reorder a header line somewhere between us and the reader's mail client.
const UNSAFE = [
  "\r",
  "\n",
  "\r\n",
  "\u0000",
  "\t",
  "\u000b",
  "\u000c",
  "\u001f",
  "\u007f",
  "\u0085", // NEL (C1)
  "\u009f",
  "\u2028", // line separator
  "\u2029", // paragraph separator
  "\u202e", // right-to-left override
  "\u202a",
  "\u2066",
  "\u2069",
  "\u200e",
  "\u200f",
  "\u061c",
  "\ud800", // lone high surrogate
  "\udc00", // lone low surrogate
];

describe("hasHeaderUnsafeCharacter", () => {
  it.each(UNSAFE.map((character) => [JSON.stringify(character), character]))(
    "flags %s anywhere in the value",
    (_label, character) => {
      expect(hasHeaderUnsafeCharacter(character)).toBe(true);
      expect(hasHeaderUnsafeCharacter(`Order${character}Bcc: x@evil.test`)).toBe(true);
      expect(hasHeaderUnsafeCharacter(`Order 1${character}`)).toBe(true);
    },
  );

  it("accepts ordinary text in any script, emoji (a valid surrogate pair) and the space", () => {
    for (const value of ["Order FK-12345 is paid", "Замовлення №12 оплачено", "Ölçü 🎉 ok", ""]) {
      expect(hasHeaderUnsafeCharacter(value), value).toBe(false);
    }
  });
});

describe("validateSubject", () => {
  it("accepts a plain subject at exactly the limit in code points", () => {
    expect(validateSubject("a".repeat(EMAIL_LIMITS.subjectMaxLength))).toEqual({ ok: true });
    // 200 emoji are 400 UTF-16 units but 200 code points.
    expect(validateSubject("🎉".repeat(EMAIL_LIMITS.subjectMaxLength))).toEqual({ ok: true });
  });

  it("refuses one code point over the limit", () => {
    expect(validateSubject("a".repeat(EMAIL_LIMITS.subjectMaxLength + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it.each([
    ["CR", "Hello\rBcc: x@evil.test"],
    ["LF", "Hello\nBcc: x@evil.test"],
    ["CRLF", "Hello\r\nBcc: x@evil.test"],
    ["NUL", "Hello\u0000"],
    ["tab", "Hello\tworld"],
    ["line separator", "Hello\u2028world"],
    ["bidi override", "Hello \u202egnp.exe"],
  ])("refuses %s", (_label, subject) => {
    expect(validateSubject(subject)).toEqual({ ok: false, reason: "forbidden_character" });
  });

  it("refuses an empty or blank subject and a non-string", () => {
    expect(validateSubject("")).toEqual({ ok: false, reason: "empty" });
    expect(validateSubject("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validateSubject(42)).toEqual({ ok: false, reason: "not_a_string" });
    expect(validateSubject(null)).toEqual({ ok: false, reason: "not_a_string" });
  });

  it("refuses leading or trailing spaces (sanitizeSubject trims them)", () => {
    expect(validateSubject(" Hello")).toEqual({ ok: false, reason: "forbidden_character" });
    expect(validateSubject("Hello ")).toEqual({ ok: false, reason: "forbidden_character" });
  });

  it("refuses a subject that is not in NFC (sanitizeSubject normalizes it)", () => {
    expect(validateSubject("Йо")).toEqual({ ok: true });
    expect(validateSubject("И\u0306о")).toEqual({ ok: false, reason: "forbidden_character" });
  });
});

describe("sanitizeSubject", () => {
  it("keeps a clean subject unchanged", () => {
    expect(sanitizeSubject("Замовлення FK-12345 оплачено")).toBe("Замовлення FK-12345 оплачено");
  });

  it("turns every unsafe character run into one space, so no header line can be injected", () => {
    expect(sanitizeSubject("Order 1\r\nBcc: victim@evil.test")).toBe(
      "Order 1 Bcc: victim@evil.test",
    );
    expect(sanitizeSubject("a\r\n\r\n\tb")).toBe("a b");
    for (const character of UNSAFE) {
      const result = sanitizeSubject(`x${character}y`);
      expect(hasHeaderUnsafeCharacter(result), JSON.stringify(character)).toBe(false);
      expect(validateSubject(result), JSON.stringify(character)).toEqual({ ok: true });
    }
  });

  it("collapses runs of spaces and trims", () => {
    expect(sanitizeSubject("  Hello    world \n ")).toBe("Hello world");
  });

  it("normalizes to NFC before counting", () => {
    expect(sanitizeSubject("И\u0306о")).toBe("Йо");
  });

  it("cuts a long subject to the limit with an ellipsis, never inside a surrogate pair", () => {
    const long = sanitizeSubject("a".repeat(500));
    expect([...long]).toHaveLength(EMAIL_LIMITS.subjectMaxLength);
    expect(long.endsWith("…")).toBe(true);
    const emoji = sanitizeSubject("🎉".repeat(500));
    expect([...emoji]).toHaveLength(EMAIL_LIMITS.subjectMaxLength);
    expect(validateSubject(emoji)).toEqual({ ok: true });
    expect(sanitizeSubject("a".repeat(EMAIL_LIMITS.subjectMaxLength))).toBe(
      "a".repeat(EMAIL_LIMITS.subjectMaxLength),
    );
  });

  it("handles a huge input quickly and safely", () => {
    const huge = "Order\r\n".repeat(200_000);
    const started = Date.now();
    const result = sanitizeSubject(huge);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(validateSubject(result)).toEqual({ ok: true });
  });

  it("answers an empty string for a blank input (validateSubject then refuses it)", () => {
    expect(sanitizeSubject("\r\n\t ")).toBe("");
  });

  it("refuses a non-string (a template bug)", () => {
    expect(() => sanitizeSubject(42 as unknown as string)).toThrow(TypeError);
  });
});
