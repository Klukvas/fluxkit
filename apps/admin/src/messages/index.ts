import { defaultLocale, isLocale, type Locale, type Messages } from "@fluxkit/ui";
import en from "./en.json";
import uk from "./uk.json";

export const messagesByLocale: Record<Locale, Messages> = { uk, en };

/** Picks the UI locale from the browser language, falling back to the default locale. */
export function detectLocale(language: string | undefined): Locale {
  const short = language?.slice(0, 2).toLowerCase() ?? "";
  return isLocale(short) ? short : defaultLocale;
}
