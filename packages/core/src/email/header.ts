import { EMAIL_LIMITS } from "./limits.js";
import { codePointLengthUpTo } from "./text.js";

/*
 * Header safety of mail (ADR 0031 decisions 14 and 16). The API sends JSON to the provider and never assembles SMTP
 * headers, but the provider does: any value that ends up in a header (subject, display name, address) must not be able to
 * end, fold or visually reorder a header line. Checks refuse; only `sanitizeSubject` repairs, because a subject is our own
 * template output with variables in it, never an address.
 */

/** Bidi embedding, override and isolate controls and marks: they reorder what the reader sees (`"\u202egnp.exe"`). */
function isBidiControl(code: number): boolean {
  return (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * Whether the UTF-16 unit at `index` is header-unsafe: a C0 or C1 control (CR, LF, NUL, tab and the rest, DEL, NEL), the
 * Unicode line or paragraph separator, a bidi control, or a lone surrogate (not encodable in UTF-8).
 */
function isUnsafeAt(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
    return true;
  }
  if (isBidiControl(code)) {
    return true;
  }
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const previous = index > 0 ? value.charCodeAt(index - 1) : 0;
    return !(previous >= 0xd800 && previous <= 0xdbff);
  }
  return false;
}

/** Whether `value` holds a character that must never reach a mail header (see `isUnsafeAt`). */
export function hasHeaderUnsafeCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isUnsafeAt(value, index)) {
      return true;
    }
  }
  return false;
}

/** `value` with every run of header-unsafe units replaced by one space. */
function replaceUnsafeRuns(value: string): string {
  let result = "";
  let start = 0;
  let index = 0;
  while (index < value.length) {
    if (!isUnsafeAt(value, index)) {
      index += 1;
      continue;
    }
    result += `${value.slice(start, index)} `;
    while (index < value.length && isUnsafeAt(value, index)) {
      index += 1;
    }
    start = index;
  }
  return result + value.slice(start);
}

export type SubjectValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "not_a_string" | "empty" | "too_long" | "forbidden_character";
    };

/**
 * The header-safe check of a subject as it is handed to a provider: a string, not blank, at most
 * `EMAIL_LIMITS.subjectMaxLength` code points, no unsafe character, already trimmed and in NFC. `sanitizeSubject`
 * output always passes unless it is empty.
 */
export function validateSubject(input: unknown): SubjectValidation {
  if (typeof input !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  if (input.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (codePointLengthUpTo(input, EMAIL_LIMITS.subjectMaxLength) > EMAIL_LIMITS.subjectMaxLength) {
    return { ok: false, reason: "too_long" };
  }
  if (
    hasHeaderUnsafeCharacter(input) ||
    input !== input.trim() ||
    input !== input.normalize("NFC")
  ) {
    return { ok: false, reason: "forbidden_character" };
  }
  return { ok: true };
}

/**
 * A subject made header-safe: NFC, every run of header-unsafe characters and white space becomes one space, trimmed,
 * and cut to `EMAIL_LIMITS.subjectMaxLength` code points with a final `…` when longer. A template's subject goes through
 * it before `validateSubject`. A non-string is a template bug (TypeError).
 */
export function sanitizeSubject(input: string): string {
  if (typeof input !== "string") {
    throw new TypeError("A subject must be a string");
  }
  const cleaned = replaceUnsafeRuns(input.normalize("NFC")).replace(/\s+/gu, " ").trim();
  const limit = EMAIL_LIMITS.subjectMaxLength;
  if (codePointLengthUpTo(cleaned, limit) <= limit) {
    return cleaned;
  }
  const kept: string[] = [];
  for (const character of cleaned) {
    if (kept.length === limit - 1) {
      break;
    }
    kept.push(character);
  }
  return `${kept.join("").trimEnd()}…`;
}
