import { validatePassword } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  GENERATED_PASSWORD_LENGTH,
  PASSWORD_ALPHABET,
  generatePassword,
  type RandomFill,
} from "./password-generator";

/** A random source that hands out the given bytes in order (then zeros). */
function scripted(bytes: number[]): RandomFill {
  let next = 0;
  return (target) => {
    for (let index = 0; index < target.length; index += 1) {
      target[index] = bytes[next] ?? 0;
      next += 1;
    }
    return target;
  };
}

describe("the generated initial password", () => {
  it("has 20 characters from an alphabet without look-alikes (0, O, 1, l, I)", () => {
    expect(GENERATED_PASSWORD_LENGTH).toBe(20);
    expect(PASSWORD_ALPHABET).not.toMatch(/[0O1lI]/);
    expect(new Set(PASSWORD_ALPHABET).size).toBe(PASSWORD_ALPHABET.length);
    const password = generatePassword();
    expect(Array.from(password)).toHaveLength(20);
    for (const character of password) expect(PASSWORD_ALPHABET).toContain(character);
  });

  it("passes core's policy for any email", () => {
    for (let run = 0; run < 200; run += 1) {
      expect(validatePassword(generatePassword(), { email: "anna@example.com" })).toEqual({
        ok: true,
      });
    }
  });

  it("maps bytes to characters without modulo bias: bytes above the last full round are thrown away", () => {
    const size = PASSWORD_ALPHABET.length;
    const limit = 256 - (256 % size);
    // 255 and `limit` are refused; then 0, 1, 2, ... pick the alphabet in order.
    const bytes = [255, limit, ...Array.from({ length: 20 }, (_, index) => index)];
    expect(generatePassword(scripted(bytes))).toBe(PASSWORD_ALPHABET.slice(0, 20));
    // `limit - 1` is the last accepted byte: it maps to the last character.
    const last = generatePassword(scripted([limit - 1, ...Array.from({ length: 19 }, () => 0)]));
    expect(last[0]).toBe(PASSWORD_ALPHABET[size - 1]);
  });

  it("uses the browser's cryptographic source by default (two passwords differ)", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });
});
