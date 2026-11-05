import { validateI18nText } from "../catalog/i18n.js";
import { BANNER_LIMITS, MAX_STORED_BANNERS, type BannerLayout } from "./limits.js";

/** One problem with a banner field. `path` is dotted (`title.uk`, `images.1.locale`), like the API's `errors[]`. */
export interface BannerFieldError {
  readonly path: string;
  readonly code: string;
  /** The violated length limit for `too_short` and `too_long`. */
  readonly limit?: number;
}

/** The content locales of the shop (`DEFAULT_LOCALE`, `LOCALES`). */
export interface BannerLocales {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}

/** The texts of a banner as stored or requested; `null` (or an empty map) = no text. */
export interface BannerContentInput {
  readonly layout: BannerLayout;
  readonly title: unknown;
  readonly text: unknown;
  readonly imageAlt: unknown;
}

function isEmptyText(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}

function textErrors(
  path: string,
  value: unknown,
  locales: BannerLocales,
  rules: { required: boolean; maxLength: number; minLength?: number },
): BannerFieldError[] {
  const result = validateI18nText(value, { ...locales, ...rules });
  if (result.ok) {
    return [];
  }
  return result.errors.map((error) => ({
    path: error.locale === undefined ? path : `${path}.${error.locale}`,
    code: error.reason,
    ...(error.limit === undefined ? {} : { limit: error.limit }),
  }));
}

/**
 * The text rules of a banner's layout (ADR 0046, plan D2 and section 7), with the core i18n validation:
 * - `card`: `title` required in the default locale (1 to 80), `text` optional (up to 200), `imageAlt` optional (up to
 *   150; absent = a decorative picture);
 * - `image`: `imageAlt` required in the default locale (it is the link's accessible name), `title` and `text` must be
 *   absent (`not_allowed_for_layout`).
 * An optional text that is given still needs the default locale. Empty array = valid.
 */
export function checkBannerContent(
  input: BannerContentInput,
  locales: BannerLocales,
): BannerFieldError[] {
  const errors: BannerFieldError[] = [];
  if (input.layout === "card") {
    errors.push(
      ...textErrors("title", input.title, locales, {
        required: true,
        minLength: 1,
        maxLength: BANNER_LIMITS.titleMaxLength,
      }),
      ...textErrors("text", input.text, locales, {
        required: false,
        maxLength: BANNER_LIMITS.textMaxLength,
      }),
    );
  } else {
    for (const field of ["title", "text"] as const) {
      if (!isEmptyText(input[field])) {
        errors.push({ path: field, code: "not_allowed_for_layout" });
      }
    }
  }
  errors.push(
    ...textErrors("imageAlt", input.imageAlt, locales, {
      required: input.layout === "image",
      maxLength: BANNER_LIMITS.imageAltMaxLength,
    }),
  );
  return errors;
}

/**
 * The locales of a banner's own pictures (table `banner_image`): each one of the content locales (`locale_not_allowed`)
 * and at most once (`duplicate`). The default locale may have its own picture too.
 */
export function checkBannerImageLocales(
  imageLocales: readonly string[],
  contentLocales: readonly string[],
): BannerFieldError[] {
  const errors: BannerFieldError[] = [];
  const seen = new Set<string>();
  imageLocales.forEach((locale, index) => {
    const path = `images.${String(index)}.locale`;
    if (!contentLocales.includes(locale)) {
      errors.push({ path, code: "locale_not_allowed" });
    } else if (seen.has(locale)) {
      errors.push({ path, code: "duplicate" });
    }
    seen.add(locale);
  });
  return errors;
}

/**
 * The picture shown for `locale`: the banner's own picture of that locale, else its default picture. The default
 * locale's own picture is never a fallback for another locale (pictures with text inside are language specific).
 */
export function resolveBannerPicture<T>(
  defaultPicture: T,
  localePictures: ReadonlyMap<string, T>,
  locale: string,
): T {
  return localePictures.get(locale) ?? defaultPicture;
}

/** A reorder must name exactly the current banners, each once (`order_mismatch` otherwise). */
export function checkBannerOrder(
  currentIds: readonly string[],
  requestedIds: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly reason: "order_mismatch" } {
  const requested = new Set(requestedIds);
  const current = new Set(currentIds);
  const same =
    requested.size === requestedIds.length &&
    requested.size === current.size &&
    [...requested].every((id) => current.has(id));
  return same ? { ok: true } : { ok: false, reason: "order_mismatch" };
}

/** Whether one more banner may be stored next to `existing` ones (at most `MAX_STORED_BANNERS`). */
export function checkBannerCount(
  existing: number,
): { readonly ok: true } | { readonly ok: false; readonly reason: "too_many_banners" } {
  return existing < MAX_STORED_BANNERS ? { ok: true } : { ok: false, reason: "too_many_banners" };
}
