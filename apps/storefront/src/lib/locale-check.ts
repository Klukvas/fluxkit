/** Locales the storefront renders that the API does not serve. Exact match: the API's `LOCALES` are plain codes. */
export function findUnsupportedLocales(
  storefrontLocales: readonly string[],
  apiLocales: readonly string[],
): string[] {
  return storefrontLocales.filter((locale) => !apiLocales.includes(locale));
}

export class LocaleMismatchError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[], apiLocales: readonly string[]) {
    super(
      `The storefront locales [${missing.join(", ")}] are not in the API's LOCALES [${apiLocales.join(", ")}] (GET /store/config). ` +
        "Add them to the API's LOCALES variable or remove them from the storefront's locales.",
    );
    this.name = "LocaleMismatchError";
    this.missing = missing;
  }
}

/**
 * The storefront and the API configure their locales separately (docs/plans/2026-10-18-storefront.md, API gap 16). A
 * locale the API does not serve would show catalog texts in the wrong language, so this is a configuration error: it is
 * logged and thrown (the route's `error.tsx` renders), never worked around.
 */
export function assertLocalesSupported(
  storefrontLocales: readonly string[],
  config: { locales: readonly string[] },
): void {
  const missing = findUnsupportedLocales(storefrontLocales, config.locales);
  if (missing.length === 0) return;
  const error = new LocaleMismatchError(missing, config.locales);
  console.error(error.message);
  throw error;
}
