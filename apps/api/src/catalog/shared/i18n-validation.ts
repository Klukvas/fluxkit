import { validateI18nText, type I18nTextError } from "@fluxkit/core";
import { z } from "zod";
import type { LocaleConfig } from "../../common/locale.js";
import type { FieldError } from "../../common/problem.js";

/**
 * Shape of a translated text in request bodies: `{ "uk": "...", "en": "..." }`. Only the structure is checked by
 * zod; the locale rules depend on configuration and come from core (`i18nFieldErrors`).
 */
export const i18nTextSchema = z.record(z.string(), z.string()).meta({
  description:
    "Translated text: locale code to text. The default locale is required for required texts.",
});

export interface I18nRules {
  readonly required: boolean;
  readonly maxLength: number;
  readonly minLength?: number;
}

function describe(error: I18nTextError): string | undefined {
  if (error.reason === "too_long") {
    return `At most ${error.limit} characters.`;
  }
  if (error.reason === "too_short") {
    return `At least ${error.limit} characters.`;
  }
  return undefined;
}

/**
 * Runs the core i18n validation with the configured locales and returns one `errors[]` entry per core error
 * (`code` = core reason, `path` = field, plus the locale when the error belongs to one). Empty array = valid.
 */
export function i18nFieldErrors(
  path: string,
  value: unknown,
  locale: LocaleConfig,
  rules: I18nRules,
): FieldError[] {
  const result = validateI18nText(value, {
    defaultLocale: locale.defaultLocale,
    locales: locale.locales,
    ...rules,
  });
  if (result.ok) {
    return [];
  }
  return result.errors.map((error) => {
    const message = describe(error);
    return {
      path: error.locale === undefined ? path : `${path}.${error.locale}`,
      code: error.reason,
      ...(message === undefined ? {} : { message }),
    };
  });
}
