import { CODE_PATTERN, TEXT_LIMITS, VALUE_CODE_PATTERN } from "../catalog/limits.js";
import { SLUG_PATTERN } from "../catalog/slug.js";

/** Category ids are lower-case UUIDs as Postgres prints them. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isSlugValue = (value: string): boolean =>
  value.length <= TEXT_LIMITS.slug && SLUG_PATTERN.test(value);
export const isUuidValue = (value: string): boolean => UUID_PATTERN.test(value);
export const isFieldCode = (value: string): boolean => CODE_PATTERN.test(value);
export const isValueCode = (value: string): boolean => VALUE_CODE_PATTERN.test(value);

/** A decimal number as the engine reads it: optional minus, digits, optional fraction; no exponent. */
export const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

/** Largest magnitude of an attribute number in a filter; far below what a double keeps exactly. */
export const MAX_FILTER_NUMBER = 1e15;

/**
 * True when the text has a C0 or C1 control character. With `allowWhitespace`, tab, line feed and carriage return are not
 * counted (they are whitespace in a search box). A loop instead of a regular expression keeps the lint rule on.
 */
export function hasControlCharacter(text: string, allowWhitespace = false): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (isControl && !(allowWhitespace && isWhitespace)) {
      return true;
    }
  }
  return false;
}
