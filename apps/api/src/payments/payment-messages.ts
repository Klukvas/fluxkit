import en from "./messages/en.json" with { type: "json" };
import uk from "./messages/uk.json" with { type: "json" };

/*
 * The texts the payments module sends to a provider (ADR 0032 decision 6: the localized "Order <number>" shown on the
 * provider's page). One flat catalog per locale, like the mail texts; no user-facing text lives in TypeScript.
 */

const CATALOGS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  uk,
  en,
});

/** The catalog of the first locale that has one, else English. */
function catalogFor(
  locales: readonly (string | null | undefined)[],
): Readonly<Record<string, string>> {
  for (const locale of locales) {
    if (locale !== null && locale !== undefined) {
      const catalog = CATALOGS[locale];
      if (catalog !== undefined) {
        return catalog;
      }
    }
  }
  return en;
}

/** The payment description (Monobank `destination`) for an order number, in the first locale with a catalog. */
export function paymentDescription(
  orderNumber: string,
  locales: readonly (string | null | undefined)[],
): string {
  const template = catalogFor(locales)["payment.description"] ?? en["payment.description"];
  return template.replace("{number}", orderNumber);
}

/** A localized text of a snapshot (`{uk: "...", en: "..."}`), in the first locale it has, else any it has. */
export function snapshotText(
  value: unknown,
  locales: readonly (string | null | undefined)[],
): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const texts = value as Record<string, unknown>;
  for (const locale of locales) {
    const text = locale === null || locale === undefined ? undefined : texts[locale];
    if (typeof text === "string" && text.trim() !== "") {
      return text;
    }
  }
  const any = Object.values(texts).find(
    (text): text is string => typeof text === "string" && text.trim() !== "",
  );
  return any ?? null;
}
