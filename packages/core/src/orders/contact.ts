import { codePointLength } from "../catalog/i18n.js";
import { hasJsonbUnsafeCharacters } from "../catalog/text-safety.js";

/*
 * Checkout input rules (plan 2026-10-17, Checkout and orders): names, phone, address and the "is a shipping address
 * needed" rule. Deliberately generic: no country-specific postal code, region or phone rule lives in core (the first
 * market is Ukraine, but the template is not; carrier branches belong to the shipping plan). Validation returns typed
 * results with every error at once so a form can show them. No clock, no I/O, inputs are not mutated.
 */

export const CONTACT_LIMITS = Object.freeze({
  /** Longest address text (region, city, lines), in code points. */
  text: 200,
  postalCode: 20,
  /** Longest first or last name. */
  name: 100,
  phoneMinDigits: 7,
  phoneMaxDigits: 15,
});

export interface Address {
  /** ISO 3166-1 alpha-2 by pattern only (two upper-case letters); no list of real countries. */
  readonly countryCode: string;
  readonly region?: string;
  readonly city: string;
  readonly postalCode?: string;
  /** Free text; until the shipping plan adds provider details it also carries things like a carrier branch. */
  readonly line1: string;
  readonly line2?: string;
  readonly recipientFirstName?: string;
  readonly recipientLastName?: string;
  /** Normalized by `normalizePhone`. */
  readonly recipientPhone?: string;
}

export type AddressErrorReason =
  | "not_an_object"
  | "unknown_field"
  | "required"
  | "not_a_string"
  | "empty"
  | "too_long"
  | "too_short"
  | "invalid_characters"
  | "invalid_format";

export interface AddressError {
  /** The address field, or an empty string when the input is not an object at all. */
  readonly field: string;
  readonly reason: AddressErrorReason;
}

export type AddressResult =
  | { readonly ok: true; readonly address: Address }
  | { readonly ok: false; readonly errors: readonly AddressError[] };

export type PhoneFailure = "not_a_string" | "invalid_format" | "too_short" | "too_long";

export type PhoneResult =
  | { readonly ok: true; readonly phone: string }
  | { readonly ok: false; readonly reason: PhoneFailure };

export type PersonNameFailure = "not_a_string" | "empty" | "too_long" | "invalid_characters";

export type PersonNameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: PersonNameFailure };

const PHONE_GRAMMAR = /^\+?[0-9 .()-]+$/;

/**
 * Optional leading `+`, then 7 to 15 ASCII digits with spaces, dashes, dots and parentheses allowed anywhere after it.
 * Returns `+digits` or `digits`; never adds or changes a country prefix. Anything else (letters, a plus in the middle,
 * other separators, non-ASCII digits) is `invalid_format`.
 */
export function normalizePhone(text: unknown): PhoneResult {
  if (typeof text !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  const trimmed = text.trim();
  if (!PHONE_GRAMMAR.test(trimmed)) {
    return { ok: false, reason: "invalid_format" };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < CONTACT_LIMITS.phoneMinDigits) {
    return { ok: false, reason: "too_short" };
  }
  if (digits.length > CONTACT_LIMITS.phoneMaxDigits) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, phone: trimmed.startsWith("+") ? `+${digits}` : digits };
}

function hasControlCharacters(text: string): boolean {
  for (let position = 0; position < text.length; position += 1) {
    const code = text.charCodeAt(position);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

type TextFailure = "not_a_string" | "empty" | "invalid_characters" | "too_long";

/** Trimmed text of 1 to `maxLength` code points without control characters, NUL or lone surrogates. */
function checkText(
  value: unknown,
  maxLength: number,
):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: TextFailure } {
  if (typeof value !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  const text = value.trim();
  if (text.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (hasControlCharacters(text) || hasJsonbUnsafeCharacters(text)) {
    return { ok: false, reason: "invalid_characters" };
  }
  if (codePointLength(text) > maxLength) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, text };
}

/** A first or last name: 1 to `CONTACT_LIMITS.name` characters. Returns the trimmed name. */
export function validatePersonName(value: unknown): PersonNameResult {
  const checked = checkText(value, CONTACT_LIMITS.name);
  return checked.ok ? { ok: true, name: checked.text } : checked;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const COUNTRY_CODE = /^[A-Z]{2}$/;

/** Address fields in the order errors are reported. */
const FIELDS: readonly {
  readonly name: keyof Address;
  readonly required: boolean;
  readonly maxLength: number;
}[] = [
  { name: "countryCode", required: true, maxLength: 2 },
  { name: "region", required: false, maxLength: CONTACT_LIMITS.text },
  { name: "city", required: true, maxLength: CONTACT_LIMITS.text },
  { name: "postalCode", required: false, maxLength: CONTACT_LIMITS.postalCode },
  { name: "line1", required: true, maxLength: CONTACT_LIMITS.text },
  { name: "line2", required: false, maxLength: CONTACT_LIMITS.text },
  { name: "recipientFirstName", required: false, maxLength: CONTACT_LIMITS.name },
  { name: "recipientLastName", required: false, maxLength: CONTACT_LIMITS.name },
  { name: "recipientPhone", required: false, maxLength: 0 },
];

/**
 * Validates a postal address for an order. Required: `countryCode`, `city`, `line1`. A field that is sent must be
 * valid (blank is `empty`, not "not sent"); `null` and `undefined` mean "not sent". Unknown fields are refused so
 * nothing unexpected is stored. Returns a frozen, trimmed copy with only the fields that were sent.
 */
export function validateAddress(input: unknown): AddressResult {
  if (!isPlainObject(input)) {
    return fail([{ field: "", reason: "not_an_object" }]);
  }
  const errors: AddressError[] = [];
  const values: Record<string, string> = {};
  for (const field of FIELDS) {
    const value = Object.hasOwn(input, field.name) ? input[field.name] : undefined;
    if (value === undefined || value === null) {
      if (field.required) {
        errors.push({ field: field.name, reason: "required" });
      }
      continue;
    }
    if (field.name === "countryCode") {
      if (typeof value !== "string") {
        errors.push({ field: field.name, reason: "not_a_string" });
      } else if (!COUNTRY_CODE.test(value)) {
        errors.push({ field: field.name, reason: "invalid_format" });
      } else {
        values[field.name] = value;
      }
    } else if (field.name === "recipientPhone") {
      const phone = normalizePhone(value);
      if (phone.ok) {
        values[field.name] = phone.phone;
      } else {
        errors.push({ field: field.name, reason: phone.reason });
      }
    } else {
      const checked = checkText(value, field.maxLength);
      if (checked.ok) {
        values[field.name] = checked.text;
      } else {
        errors.push({ field: field.name, reason: checked.reason });
      }
    }
  }
  const known = new Set<string>(FIELDS.map((field) => field.name));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      errors.push({ field: key, reason: "unknown_field" });
    }
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return Object.freeze({ ok: true as const, address: Object.freeze(values as unknown as Address) });
}

function fail(errors: AddressError[]): AddressResult {
  return Object.freeze({
    ok: false as const,
    errors: Object.freeze(errors.map((error) => Object.freeze(error))),
  });
}

/** An order of digital goods only needs no shipping address; one physical line is enough to require it. */
export function shippingAddressRequired(
  lines: readonly { readonly requiresShipping: boolean }[],
): boolean {
  if (!Array.isArray(lines)) {
    throw new RangeError("shippingAddressRequired needs a list of lines");
  }
  let required = false;
  for (const line of lines) {
    if (typeof line.requiresShipping !== "boolean") {
      throw new RangeError("A line needs a boolean requiresShipping flag");
    }
    required = required || line.requiresShipping;
  }
  return required;
}
