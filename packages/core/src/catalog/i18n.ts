import { hasJsonbUnsafeCharacters } from "./text-safety.js";
import type { I18nText } from "./types.js";

export type I18nTextErrorReason =
  | "required"
  | "not_an_object"
  | "default_locale_missing"
  | "locale_not_allowed"
  | "not_a_string"
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_characters";

export interface I18nTextError {
  readonly reason: I18nTextErrorReason;
  readonly locale?: string;
  /** The violated length limit for `too_short` and `too_long`. */
  readonly limit?: number;
}

export type I18nTextResult =
  { readonly ok: true } | { readonly ok: false; readonly errors: readonly I18nTextError[] };

export interface I18nTextOptions {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly maxLength: number;
  readonly minLength?: number;
  /** When false, an absent or empty map is valid; a non-empty map still needs the default locale. */
  readonly required: boolean;
}

/** Length in Unicode code points, the way Postgres counts characters. */
export function codePointLength(text: string): number {
  return [...text].length;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Validates a translated text map. The default locale is configuration, not a database rule
 * (ADR 0006 decision 1), so it is checked here.
 */
export function validateI18nText(value: unknown, options: I18nTextOptions): I18nTextResult {
  const isAbsent = value === undefined || value === null;
  if (!isAbsent && !isPlainObject(value)) {
    return { ok: false, errors: [{ reason: "not_an_object" }] };
  }
  const entries = isPlainObject(value) ? Object.entries(value) : [];
  if (entries.length === 0) {
    return options.required ? { ok: false, errors: [{ reason: "required" }] } : { ok: true };
  }

  const errors: I18nTextError[] = [];
  for (const [locale, text] of entries) {
    if (!options.locales.includes(locale)) {
      errors.push({ reason: "locale_not_allowed", locale });
      continue;
    }
    if (typeof text !== "string") {
      errors.push({ reason: "not_a_string", locale });
      continue;
    }
    if (text.trim().length === 0) {
      errors.push({ reason: "empty", locale });
      continue;
    }
    if (hasJsonbUnsafeCharacters(text)) {
      errors.push({ reason: "invalid_characters", locale });
      continue;
    }
    const length = codePointLength(text);
    if (options.minLength !== undefined && length < options.minLength) {
      errors.push({ reason: "too_short", locale, limit: options.minLength });
    }
    if (length > options.maxLength) {
      errors.push({ reason: "too_long", locale, limit: options.maxLength });
    }
  }
  if (!entries.some(([locale]) => locale === options.defaultLocale)) {
    errors.push({ reason: "default_locale_missing", locale: options.defaultLocale });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Picks the requested locale and falls back to the default locale, per field (ADR 0006 section 10). */
export function resolveText(
  text: I18nText | null | undefined,
  locale: string,
  defaultLocale: string,
): string | undefined {
  if (text === null || text === undefined) {
    return undefined;
  }
  const own = (key: string): string | undefined =>
    Object.hasOwn(text, key) ? text[key] : undefined;
  return own(locale) ?? own(defaultLocale);
}
