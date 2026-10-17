import { describe, expect, it } from "vitest";
import {
  ORDER_NUMBER_ALPHABET,
  ORDER_NUMBER_BYTES,
  ORDER_NUMBER_PATTERN,
  formatOrderNumber,
  parseOrderNumber,
} from "./number.js";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent reference: read the 40 bits of the bytes five at a time, most significant first. */
function referenceFormat(bytes: readonly number[]): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bit = (position: number): number => {
    const byte = bytes[Math.floor(position / 8)] ?? 0;
    return (byte >> (7 - (position % 8))) & 1;
  };
  let text = "";
  for (let symbol = 0; symbol < 8; symbol += 1) {
    let index = 0;
    for (let offset = 0; offset < 5; offset += 1) {
      index = index * 2 + bit(symbol * 5 + offset);
    }
    text += alphabet.charAt(index);
  }
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

describe("the alphabet and pattern", () => {
  it("is Crockford base32: 32 symbols, no I, L, O or U", () => {
    expect(ORDER_NUMBER_ALPHABET).toHaveLength(32);
    expect(new Set(ORDER_NUMBER_ALPHABET).size).toBe(32);
    for (const letter of "ILOU") {
      expect(ORDER_NUMBER_ALPHABET).not.toContain(letter);
    }
    expect(ORDER_NUMBER_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    expect(ORDER_NUMBER_BYTES).toBe(5);
  });

  it("the pattern accepts exactly the canonical form", () => {
    expect(ORDER_NUMBER_PATTERN.test("7K3M-9QX2")).toBe(true);
    for (const text of [
      "7K3M9QX2",
      "7k3m-9qx2",
      "7K3I-9QX2",
      "7K3L-9QX2",
      "7K3O-9QX2",
      "7K3U-9QX2",
      "7K3M-9QX",
      "7K3M-9QX22",
      "7K3M-9QX2\n",
    ]) {
      expect(ORDER_NUMBER_PATTERN.test(text), text).toBe(false);
    }
    for (const letter of ORDER_NUMBER_ALPHABET) {
      expect(ORDER_NUMBER_PATTERN.test(`${letter}000-000${letter}`), letter).toBe(true);
    }
  });
});

describe("formatOrderNumber", () => {
  it("formats known vectors", () => {
    const vectors: [number[], string][] = [
      [[0, 0, 0, 0, 0], "0000-0000"],
      [[255, 255, 255, 255, 255], "ZZZZ-ZZZZ"],
      [[1, 2, 3, 4, 5], "0410-6105"],
      [[0xde, 0xad, 0xbe, 0xef, 0x00], "VTPV-XVR0"],
      [[0, 0, 0, 0, 32], "0000-0010"],
      [[0x80, 0, 0, 0, 0], "G000-0000"],
    ];
    for (const [bytes, expected] of vectors) {
      expect(formatOrderNumber(Uint8Array.from(bytes)), expected).toBe(expected);
    }
  });

  it("uses all 40 bits: flipping any single bit changes the number", () => {
    const base = formatOrderNumber(new Uint8Array(5));
    for (let bit = 0; bit < 40; bit += 1) {
      const bytes = new Uint8Array(5);
      bytes[Math.floor(bit / 8)] = 1 << (7 - (bit % 8));
      const number = formatOrderNumber(bytes);
      expect(number, `bit ${String(bit)}`).not.toBe(base);
      expect(number).toBe(referenceFormat(Array.from(bytes)));
    }
  });

  it("works on a view into a larger buffer and does not change its input", () => {
    const buffer = Uint8Array.from([9, 9, 1, 2, 3, 4, 5, 9]);
    const view = buffer.subarray(2, 7);
    expect(formatOrderNumber(view)).toBe("0410-6105");
    expect([...buffer]).toEqual([9, 9, 1, 2, 3, 4, 5, 9]);
  });

  it("needs exactly five bytes in a Uint8Array (RangeError)", () => {
    for (const length of [0, 1, 4, 6, 8]) {
      expect(() => formatOrderNumber(new Uint8Array(length)), String(length)).toThrow(RangeError);
    }
    expect(() => formatOrderNumber([1, 2, 3, 4, 5] as unknown as Uint8Array)).toThrow(RangeError);
    expect(() => formatOrderNumber(null as unknown as Uint8Array)).toThrow(RangeError);
    expect(() => formatOrderNumber("12345" as unknown as Uint8Array)).toThrow(RangeError);
    expect(() => formatOrderNumber(new Uint16Array(5) as unknown as Uint8Array)).toThrow(
      RangeError,
    );
  });

  it("matches the reference, always fits the pattern and never repeats on 20 000 seeded random inputs", () => {
    const next = mulberry32(0x0badc0de);
    const seen = new Set<string>();
    for (let iteration = 0; iteration < 20_000; iteration += 1) {
      const bytes = Uint8Array.from({ length: 5 }, () => Math.floor(next() * 256));
      const number = formatOrderNumber(bytes);
      expect(number).toBe(referenceFormat(Array.from(bytes)));
      expect(ORDER_NUMBER_PATTERN.test(number)).toBe(true);
      const key = [...bytes].join(",");
      seen.add(`${key}|${number}`);
    }
    // Distinct inputs gave distinct numbers: the number of distinct numbers equals the number of distinct inputs.
    const numbers = new Set([...seen].map((entry) => entry.split("|")[1]));
    const inputs = new Set([...seen].map((entry) => entry.split("|")[0]));
    expect(numbers.size).toBe(inputs.size);
  });
});

describe("parseOrderNumber", () => {
  const ok = (number: string) => ({ ok: true, number });
  const bad = { ok: false, reason: "invalid_order_number" };

  it("returns the canonical form of a canonical number", () => {
    expect(parseOrderNumber("7K3M-9QX2")).toEqual(ok("7K3M-9QX2"));
    expect(parseOrderNumber("0000-0000")).toEqual(ok("0000-0000"));
  });

  it("accepts lower case, a missing dash and surrounding whitespace", () => {
    expect(parseOrderNumber("7k3m-9qx2")).toEqual(ok("7K3M-9QX2"));
    expect(parseOrderNumber("7K3M9QX2")).toEqual(ok("7K3M-9QX2"));
    expect(parseOrderNumber("7k3m9qx2")).toEqual(ok("7K3M-9QX2"));
    expect(parseOrderNumber("  7K3M-9QX2\n")).toEqual(ok("7K3M-9QX2"));
  });

  it("reads the look-alikes the way Crockford says: O is 0, I and L are 1", () => {
    expect(parseOrderNumber("OOOO-OOOO")).toEqual(ok("0000-0000"));
    expect(parseOrderNumber("oooo-oooo")).toEqual(ok("0000-0000"));
    expect(parseOrderNumber("IIII-LLLL")).toEqual(ok("1111-1111"));
    expect(parseOrderNumber("iiil-lli1")).toEqual(ok("1111-1111"));
    expect(parseOrderNumber("7K3M-9QXO")).toEqual(ok("7K3M-9QX0"));
  });

  it("rejects the wrong length", () => {
    for (const text of ["", "7K3M-9QX", "7K3M-9QX22", "7K3M9QX", "7K3M9QX22", "7", "-"]) {
      expect(parseOrderNumber(text), text).toEqual(bad);
    }
  });

  it("rejects U (not in the alphabet) in any case", () => {
    expect(parseOrderNumber("7K3U-9QX2")).toEqual(bad);
    expect(parseOrderNumber("7k3u-9qx2")).toEqual(bad);
  });

  it("rejects a dash anywhere but between the two groups, and more than one", () => {
    for (const text of [
      "7K3-M9QX2",
      "7K3M-9QX-2",
      "7K3M--9QX2",
      "-7K3M9QX2",
      "7K3M9QX2-",
      "7-K-3-M-9-Q-X-2",
      "7K3M_9QX2",
      "7K3M 9QX2",
      "7K3M\t9QX2",
    ]) {
      expect(parseOrderNumber(text), JSON.stringify(text)).toEqual(bad);
    }
  });

  it("rejects non-ASCII look-alikes and Unicode case tricks", () => {
    for (const text of [
      "7K3М-9QX2", // Cyrillic M
      "7К3M-9QX2", // Cyrillic K
      "７K3M-9QX2", // full-width digit
      "ßßßß-ßßßß",
      "ſſſſ-ſſſſ", // long s uppercases to S
      "7K3M‐9QX2", // Unicode hyphen
      "7K3M−9QX2", // minus sign
      "7K3M​-9QX2", // zero-width space
    ]) {
      expect(parseOrderNumber(text), text).toEqual(bad);
    }
  });

  it("rejects text with a NUL or a line break inside", () => {
    expect(parseOrderNumber("7K3M\u0000-9QX2")).toEqual(bad);
    expect(parseOrderNumber("7K3M-\n9QX2")).toEqual(bad);
  });

  it("rejects anything that is not text", () => {
    for (const value of [undefined, null, 0, 12345678, {}, [], ["7K3M-9QX2"], true, Symbol("x")]) {
      expect(parseOrderNumber(value), String(value)).toEqual(bad);
    }
  });

  it("returns a frozen result", () => {
    expect(Object.isFrozen(parseOrderNumber("7K3M-9QX2"))).toBe(true);
    expect(Object.isFrozen(parseOrderNumber("nope"))).toBe(true);
  });

  it("round-trips: parse(format(bytes)) is the number, also after the typing mistakes parse forgives (20 000 seeded cases)", () => {
    const next = mulberry32(0x5eed5eed);
    for (let iteration = 0; iteration < 20_000; iteration += 1) {
      const bytes = Uint8Array.from({ length: 5 }, () => Math.floor(next() * 256));
      const number = formatOrderNumber(bytes);
      expect(parseOrderNumber(number)).toEqual(ok(number));

      let typed = "";
      for (const character of number) {
        let letter = character;
        if (letter === "0" && next() < 0.5) letter = next() < 0.5 ? "O" : "o";
        else if (letter === "1" && next() < 0.5)
          letter = ["I", "i", "L", "l"][Math.floor(next() * 4)] ?? "I";
        else if (next() < 0.3) letter = letter.toLowerCase();
        typed += letter;
      }
      if (next() < 0.5) typed = typed.replace("-", "");
      expect(parseOrderNumber(typed), typed).toEqual(ok(number));
    }
  });

  it("the canonical text of a parse is always fixed: parsing it again changes nothing", () => {
    const next = mulberry32(0x1234abcd);
    for (let iteration = 0; iteration < 2_000; iteration += 1) {
      const text = Array.from({ length: 8 }, () =>
        "0123456789abcdefghijklmnopqrstuvwxyz".charAt(Math.floor(next() * 36)),
      ).join("");
      const first = parseOrderNumber(text);
      if (first.ok) {
        expect(ORDER_NUMBER_PATTERN.test(first.number)).toBe(true);
        expect(parseOrderNumber(first.number)).toEqual(first);
      }
    }
  });
});
