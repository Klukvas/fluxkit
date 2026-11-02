import type { Locale } from "@fluxkit/ui";

/**
 * The flag shown next to each language in the header's language menu (decoration only: the language's own name is the label,
 * from `locale.name.<locale>`). A language is not a country, so this is a shop decision: a client changes the country here
 * and adds `public/flags/<country>.svg` with a `.fk-flag-<country>` rule in `app/globals.css`. Internal, not a contract.
 */
export const localeFlagCountry: Record<Locale, string> = {
  uk: "ua",
  en: "gb",
};

/** The CSS classes that draw the flag of a locale. */
export function flagClass(locale: Locale): string {
  return `fk-flag fk-flag-${localeFlagCountry[locale]}`;
}
