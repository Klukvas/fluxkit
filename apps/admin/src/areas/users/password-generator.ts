/**
 * An optional helper for the initial or reset password: 20 characters drawn with the browser's cryptographic random
 * source (`crypto.getRandomValues`), never `Math.random`. The alphabet has no look-alikes (0, O, 1, l, I), so the owner can
 * read it out or type it when handing it over. Bytes are mapped without modulo bias (a byte above the last full round of
 * the alphabet is thrown away). The result is only put into the form's field; it is never stored, logged or sent anywhere
 * else.
 */

export const GENERATED_PASSWORD_LENGTH = 20;
export const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Fills the array with random bytes and returns it (the signature of `crypto.getRandomValues`). */
export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

const browserRandom: RandomFill = (bytes) => globalThis.crypto.getRandomValues(bytes);

export function generatePassword(fill: RandomFill = browserRandom): string {
  const size = PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % size);
  let password = "";
  const buffer = new Uint8Array(GENERATED_PASSWORD_LENGTH * 2);
  while (password.length < GENERATED_PASSWORD_LENGTH) {
    fill(buffer);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      password += PASSWORD_ALPHABET.charAt(byte % size);
      if (password.length === GENERATED_PASSWORD_LENGTH) break;
    }
  }
  return password;
}
