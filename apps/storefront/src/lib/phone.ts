import {
  AsYouType,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from "libphonenumber-js/min";
import { clientFailure, type Failure } from "./failure";

/**
 * The checkout's phone field (owner decision 2026-11-02: `libphonenumber-js`, its small "min" metadata build). Pure.
 *
 * - The default country is the shop's (`checkoutConfig.phoneDefaultCountry`, `UA`): a number typed without `+` is read as a
 *   number of that country, one typed with `+` as international.
 * - While typing, the number is shown in its national format (`formatPhoneTyping`); the island applies it only when the
 *   text grew at its end, so deleting or editing in the middle never fights the shopper or moves the caret.
 * - On submit `checkPhone` refuses a number of a wrong length or one the metadata cannot read (friendly per-field texts),
 *   and gives the E.164 form (`+380501234567`) that the request carries. The API keeps its own, wider rule
 *   (`normalizePhone` in core: optional `+`, 7 to 15 digits): nothing on the server is loosened; E.164 passes it.
 * - The "min" metadata checks the length and the country, not every number range, so a well-formed but unassigned number
 *   can pass; that is accepted (the shop calls or messages the shopper).
 */

export type PhoneProblem = "too_short" | "too_long" | "invalid";

export type PhoneCheck = { ok: true; e164: string } | { ok: false; problem: PhoneProblem };

/** The text as it should be shown while typing: national format for the default country, international after a `+`. */
export function formatPhoneTyping(text: string, country: CountryCode): string {
  // Characters that cannot be part of a number are dropped by the formatter; keep the text when it gives nothing back.
  const formatted = new AsYouType(country).input(text);
  return formatted === "" ? text : formatted;
}

export function checkPhone(text: string, country: CountryCode): PhoneCheck {
  const trimmed = text.trim();
  const length = validatePhoneNumberLength(trimmed, country);
  if (length === "TOO_SHORT") return { ok: false, problem: "too_short" };
  if (length === "TOO_LONG") return { ok: false, problem: "too_long" };
  if (length !== undefined) return { ok: false, problem: "invalid" };
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (parsed === undefined || !parsed.isValid()) return { ok: false, problem: "invalid" };
  return { ok: true, e164: parsed.number };
}

/** A stored phone (an account's, E.164 or digits) as the field shows it: national for the default country, else international. */
export function phoneForDisplay(stored: string, country: CountryCode): string {
  const parsed = parsePhoneNumberFromString(stored, country);
  if (parsed === undefined || !parsed.isValid()) return stored;
  return parsed.country === country ? parsed.formatNational() : parsed.formatInternational();
}

/** The message of a refused phone, shown on the field (`checkout.field.phone.error.<problem>`). */
export function phoneFailure(path: string, problem: PhoneProblem): Failure {
  return clientFailure("errors.validation_failed", [
    { path, code: problem, messageKey: `checkout.field.phone.error.${problem}` },
  ]);
}
