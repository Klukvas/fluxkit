/*
 * Order numbers (plan 2026-10-17, Order number; ADR 0017). 40 random bits are shown as 8 Crockford base32 symbols, `XXXX-XXXX`
 * (for example `7K3M-9QX2`): readable aloud (no I, L, O, U), not sequential (it does not reveal sales volume), and
 * not a secret (reading an order always needs a session or an access token). The random bytes come from the caller, so
 * this module stays pure; uniqueness is the database's job (unique constraint, retry with new bytes). No client prefix:
 * that would be branding.
 */

/** Crockford base32: digits then letters without I, L, O and U. */
export const ORDER_NUMBER_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 5 bytes are 40 bits, exactly 8 symbols of 5 bits. */
export const ORDER_NUMBER_BYTES = 5;

/** The stored form (also the database CHECK). */
export const ORDER_NUMBER_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const SYMBOLS = 8;
const BITS_PER_SYMBOL = 5;

export type ParsedOrderNumber =
  | { readonly ok: true; readonly number: string }
  | { readonly ok: false; readonly reason: "invalid_order_number" };

/** Exactly `ORDER_NUMBER_BYTES` random bytes in a `Uint8Array`; anything else is a bug in the caller (RangeError). */
export function formatOrderNumber(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length !== ORDER_NUMBER_BYTES) {
    throw new RangeError(`An order number needs exactly ${String(ORDER_NUMBER_BYTES)} bytes`);
  }
  let symbols = "";
  let buffer = 0;
  let bufferedBits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bufferedBits += 8;
    while (bufferedBits >= BITS_PER_SYMBOL) {
      bufferedBits -= BITS_PER_SYMBOL;
      symbols += ORDER_NUMBER_ALPHABET.charAt((buffer >> bufferedBits) & 31);
    }
    buffer &= (1 << bufferedBits) - 1;
  }
  return `${symbols.slice(0, SYMBOLS / 2)}-${symbols.slice(SYMBOLS / 2)}`;
}

const ASCII_WORD = /^[0-9A-Za-z-]+$/;
const GROUPED = /^[0-9A-Z]{4}-[0-9A-Z]{4}$/;
const PLAIN = /^[0-9A-Z]{8}$/;

const INVALID: ParsedOrderNumber = Object.freeze({
  ok: false as const,
  reason: "invalid_order_number" as const,
});

/**
 * Reads what a person typed or pasted and returns the stored form. Forgiven: surrounding whitespace, lower case, a
 * missing dash, and Crockford's look-alikes (O is 0, I and L are 1). Everything else is `invalid_order_number`: another
 * length, a dash anywhere but in the middle, the letter U, and every non-ASCII character (checked first, so Unicode case
 * mapping can never turn a look-alike into a valid symbol).
 */
export function parseOrderNumber(text: unknown): ParsedOrderNumber {
  if (typeof text !== "string") {
    return INVALID;
  }
  const trimmed = text.trim();
  if (!ASCII_WORD.test(trimmed)) {
    return INVALID;
  }
  const upper = trimmed.toUpperCase();
  if (!(upper.includes("-") ? GROUPED.test(upper) : PLAIN.test(upper))) {
    return INVALID;
  }
  const symbols = upper.replace("-", "").replace(/O/g, "0").replace(/[IL]/g, "1");
  for (const symbol of symbols) {
    if (!ORDER_NUMBER_ALPHABET.includes(symbol)) {
      return INVALID;
    }
  }
  return Object.freeze({
    ok: true as const,
    number: `${symbols.slice(0, SYMBOLS / 2)}-${symbols.slice(SYMBOLS / 2)}`,
  });
}
