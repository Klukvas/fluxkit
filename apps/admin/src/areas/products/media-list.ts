import type {
  AdminProductMedia,
  LocalizedText,
  PutProductMediaBody,
  PutProductMediaItem,
} from "@fluxkit/api-client";
import { jsonEqual } from "../../lib/diff-for-patch";
import { describeFieldError } from "../../lib/problem-messages";
import { safeHttpUrl } from "../../lib/safe-http-url";
import { issue, type FormIssues } from "../catalog-dictionaries/form-rules";
import {
  localeMapFromValues,
  localeValuesFrom,
  type LocaleValues,
} from "../catalog-dictionaries/locale-text";

/**
 * The Media tab's list (plan step 6, "Media (URL list, preview, alt, position, option value)"): the product's images as
 * http(s) addresses, edited as a whole and saved with `PUT /admin/products/{id}/media`, which replaces the list
 * (`docs/api/catalog.md`). The shown order is the position (0, 1, 2, ...). Pure; the screen holds no list logic.
 */

/** The API's caps: 100 images per product, alt text 255 characters per locale (core `TEXT_LIMITS.alt`). */
export const MAX_MEDIA = 100;
export const ALT_MAX_LENGTH = 255;

export interface MediaRow {
  /** Stable key for the screen: the stored id, or a key made for a new row. Never sent. */
  key: string;
  url: string;
  /** One string per content locale. */
  alt: LocaleValues;
  /** The linked option value, as a pair (the API takes both or neither). */
  optionId: string | null;
  optionValueId: string | null;
}

export interface MediaLink {
  optionId: string;
  optionValueId: string;
}

/** The key of an option value pair, for the set of values the product chose. */
export function pairKey(optionId: string, optionValueId: string): string {
  return `${optionId}:${optionValueId}`;
}

/** The rows of the stored list, in position order (ties keep the API's order). */
export function mediaRowsFrom(
  media: readonly AdminProductMedia[],
  locales: readonly string[],
): MediaRow[] {
  return [...media]
    .sort((left, right) => left.position - right.position)
    .map((entry) => ({
      key: entry.id,
      url: entry.url,
      alt: localeValuesFrom(entry.alt, locales),
      optionId: entry.optionId,
      optionValueId: entry.optionValueId,
    }));
}

export function newMediaRow(key: string, locales: readonly string[]): MediaRow {
  return {
    key,
    url: "",
    alt: localeValuesFrom(null, locales),
    optionId: null,
    optionValueId: null,
  };
}

/** The row of an uploaded file: its URL from the server's answer, no alt text, no option value. Unsaved until the list is saved. */
export function uploadedMediaRow(key: string, url: string, locales: readonly string[]): MediaRow {
  return { ...newMediaRow(key, locales), url };
}

/** A new row at the end; the same list when it is full. */
export function addMedia(rows: readonly MediaRow[], row: MediaRow): readonly MediaRow[] {
  return rows.length >= MAX_MEDIA ? rows : [...rows, row];
}

export function removeMedia(rows: readonly MediaRow[], index: number): readonly MediaRow[] {
  if (index < 0 || index >= rows.length) return rows;
  return rows.filter((_, at) => at !== index);
}

/** Swaps the row with its neighbour above (`-1`) or below (`1`); the same list at either end. */
export function moveMedia(
  rows: readonly MediaRow[],
  index: number,
  delta: -1 | 1,
): readonly MediaRow[] {
  const target = index + delta;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const moved = next[index] as MediaRow;
  next[index] = next[target] as MediaRow;
  next[target] = moved;
  return next;
}

export function updateMedia(
  rows: readonly MediaRow[],
  index: number,
  change: Partial<Pick<MediaRow, "url" | "alt">>,
): readonly MediaRow[] {
  return rows.map((row, at) => (at === index ? { ...row, ...change } : row));
}

/** Links the row to one option value, or unlinks it (`null`). */
export function setMediaLink(
  rows: readonly MediaRow[],
  index: number,
  link: MediaLink | null,
): readonly MediaRow[] {
  return rows.map((row, at) =>
    at === index
      ? {
          ...row,
          optionId: link?.optionId ?? null,
          optionValueId: link?.optionValueId ?? null,
        }
      : row,
  );
}

export interface MediaCheckContext {
  defaultLocale: string;
  locales: readonly string[];
  /** The option values the product chose (`pairKey`): a link must be one of them (the API's `invalid_reference`). */
  chosenPairs: ReadonlySet<string>;
}

/**
 * Early feedback, keyed by the API's error paths (`media.N.url`, `media.N.alt.<locale>`, `media.N.optionValueId`): an
 * address must be an absolute http(s) URL of at most 2048 characters (`safeHttpUrl`, the same check the preview uses), an
 * alt text at most 255 characters and, once given, also in the default locale, a link one of the product's chosen values. The server checks again and decides.
 */
export function validateMedia(rows: readonly MediaRow[], context: MediaCheckContext): FormIssues {
  const issues: FormIssues = {};
  if (rows.length > MAX_MEDIA)
    issues["media"] = issue("products.media.tooMany", { max: MAX_MEDIA });
  rows.forEach((row, index) => {
    const url = row.url.trim();
    if (url === "") issues[`media.${index}.url`] = describeFieldError("required");
    else if (safeHttpUrl(url) === null)
      issues[`media.${index}.url`] = issue("products.media.urlInvalid");
    for (const locale of context.locales) {
      const text = (row.alt[locale] ?? "").trim();
      if ([...text].length > ALT_MAX_LENGTH) {
        issues[`media.${index}.alt.${locale}`] = issue("products.media.altTooLong", {
          max: ALT_MAX_LENGTH,
        });
      }
    }
    const anyAlt = context.locales.some((locale) => (row.alt[locale] ?? "").trim() !== "");
    if (anyAlt && (row.alt[context.defaultLocale] ?? "").trim() === "") {
      // An optional text that is given needs the default locale too (core `validateI18nText`).
      issues[`media.${index}.alt.${context.defaultLocale}`] ??=
        describeFieldError("default_locale_missing");
    }
    if (
      row.optionId !== null &&
      row.optionValueId !== null &&
      !context.chosenPairs.has(pairKey(row.optionId, row.optionValueId))
    ) {
      issues[`media.${index}.optionValueId`] = issue("products.media.linkNotChosen");
    }
  });
  return issues;
}

function altOf(values: LocaleValues, locales: readonly string[]): LocalizedText | null {
  const map = localeMapFromValues(values, locales);
  return Object.keys(map).length === 0 ? null : map;
}

/**
 * `PUT /admin/products/{id}/media`: every row in the shown order with its index as position, the trimmed address, the
 * alt map of the content locales that have text (or `null`), and the option pair (or two `null`s).
 */
export function mediaBody(
  rows: readonly MediaRow[],
  locales: readonly string[],
): PutProductMediaBody {
  return {
    media: rows.map((row, index): PutProductMediaItem => ({
      url: row.url.trim(),
      alt: altOf(row.alt, locales),
      position: index,
      optionId: row.optionId,
      optionValueId: row.optionValueId,
    })),
  };
}

/** Whether saving would change the stored list (the unsaved-changes guard and "nothing changed"). */
export function mediaDirty(
  initial: readonly MediaRow[],
  current: readonly MediaRow[],
  locales: readonly string[],
): boolean {
  return !jsonEqual(mediaBody(initial, locales), mediaBody(current, locales));
}

/**
 * Whether leaving the tab would lose something: edited rows, or uploads still running (the rows they will add are not
 * in the list yet). Feeds the unsaved-changes guard and the editor's lifecycle lock.
 */
export function unsavedMedia(
  initial: readonly MediaRow[],
  current: readonly MediaRow[],
  locales: readonly string[],
  uploading: boolean,
): boolean {
  return uploading || mediaDirty(initial, current, locales);
}

/** How many stored images the edited list no longer has (the save asks before it removes them). */
export function removedMediaCount(
  initial: readonly MediaRow[],
  current: readonly MediaRow[],
): number {
  const kept = new Set(current.map((row) => row.key));
  return initial.filter((row) => !kept.has(row.key)).length;
}
