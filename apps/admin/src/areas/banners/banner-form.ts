import type {
  AdminHomeBanner,
  AdminHomeBannerLayout,
  AdminHomeBannerTone,
  AdminMediaUpload,
  CreateAdminHomeBannerBody,
  LocalizedText,
  ProblemDetails,
  UpdateAdminHomeBannerBody,
} from "@fluxkit/api-client";
import { diffForPatch } from "../../lib/diff-for-patch";
import type { FormErrors } from "../../lib/form-errors";
import type { ContentLocales } from "../catalog-dictionaries/form-parts";
import { issue, type FormIssues } from "../catalog-dictionaries/form-rules";
import {
  localeFieldNames,
  localeValuesFrom,
  optionalLocaleMap,
  type LocaleValues,
} from "../catalog-dictionaries/locale-text";
import { formErrorsFromProblem } from "../catalog-dictionaries/submit-errors";
import { BANNER_LIMITS, checkBannerLink, codePointLength, inWindowBounds } from "./banner-rules";
import { isoToLocalInput, localInputToIso } from "./banner-time";

/**
 * The banner form (plan D5 and section 7): the values the admin edits, the checks before sending, the request bodies and
 * the server's refusals on the fields. Pure functions; the screens are in `banner-pages.tsx`.
 */

/** A picture the form shows: an upload (its id is what the API stores) with its address and size. */
export interface BannerPicture {
  uploadId: string;
  url: string;
  width: number;
  height: number;
}

export interface BannerFormValues {
  layout: AdminHomeBannerLayout;
  /** Kept while the layout is `image` (hidden then and not sent), so switching back loses nothing. */
  title: LocaleValues;
  text: LocaleValues;
  imageAlt: LocaleValues;
  /** The default picture, shown for every locale without its own; required. */
  picture: BannerPicture | null;
  /** Own pictures by content locale; a locale without one uses the default picture. */
  localePictures: Readonly<Record<string, BannerPicture>>;
  link: string;
  tone: AdminHomeBannerTone;
  isActive: boolean;
  /** `datetime-local` text in the form's time zone; `""` = open. */
  startsAt: string;
  endsAt: string;
}

export function pictureFromUpload(upload: AdminMediaUpload): BannerPicture {
  return { uploadId: upload.id, url: upload.url, width: upload.width, height: upload.height };
}

export function emptyBannerForm(locales: readonly string[]): BannerFormValues {
  const blank = localeValuesFrom(null, locales);
  return {
    layout: "card",
    title: blank,
    text: blank,
    imageAlt: blank,
    picture: null,
    localePictures: {},
    link: "",
    tone: "surface",
    isActive: false,
    startsAt: "",
    endsAt: "",
  };
}

export function bannerFormFrom(
  banner: AdminHomeBanner,
  locales: readonly string[],
  timeZone: string,
): BannerFormValues {
  const own: Record<string, BannerPicture> = {};
  for (const image of banner.images) {
    // A picture of a locale that is no longer configured is not shown; saving the pictures drops it.
    if (locales.includes(image.locale)) {
      own[image.locale] = {
        uploadId: image.uploadId,
        url: image.url,
        width: image.width,
        height: image.height,
      };
    }
  }
  return {
    layout: banner.layout,
    title: localeValuesFrom(banner.title, locales),
    text: localeValuesFrom(banner.text, locales),
    imageAlt: localeValuesFrom(banner.imageAlt, locales),
    picture: banner.image,
    localePictures: own,
    link: banner.link,
    tone: banner.tone,
    isActive: banner.isActive,
    startsAt: isoToLocalInput(banner.startsAt, timeZone),
    endsAt: isoToLocalInput(banner.endsAt, timeZone),
  };
}

// ------------------------------------------------------------------ field names (the API's `errors[].path`)

export function pictureField(locale: string | null): string {
  return locale === null ? "imageUploadId" : `picture.${locale}`;
}

export function bannerFieldNames(locales: readonly string[]): string[] {
  return [
    "layout",
    "title",
    "text",
    "imageAlt",
    ...localeFieldNames("title", locales),
    ...localeFieldNames("text", locales),
    ...localeFieldNames("imageAlt", locales),
    pictureField(null),
    ...locales.map((locale) => pictureField(locale)),
    "link",
    "tone",
    "isActive",
    "startsAt",
    "endsAt",
  ];
}

// ------------------------------------------------------------------ checks before sending

/**
 * Whether a picture is within 5 % of the storefront frame's 2:1 (a warning only: the frame crops anything else). Whole
 * numbers only: `|width - 2 * height| <= 5 % of 2 * height`, so 1344 x 640 is exactly at the limit, not off by a rounding.
 */
export function hasBannerRatio(picture: Pick<BannerPicture, "width" | "height">): boolean {
  if (picture.width <= 0 || picture.height <= 0) return false;
  const target = 2 * picture.height;
  return 20 * Math.abs(picture.width - target) <= target;
}

function textIssues(
  field: "title" | "text" | "imageAlt",
  values: LocaleValues,
  content: ContentLocales,
  rules: { required: boolean; maxLength: number },
): FormIssues {
  const issues: FormIssues = {};
  const filled = content.locales.filter((locale) => (values[locale] ?? "").trim() !== "");
  for (const locale of filled) {
    const length = codePointLength((values[locale] ?? "").trim());
    if (length > rules.maxLength) {
      issues[`${field}.${locale}`] = issue("banners.form.tooLong", { limit: rules.maxLength });
    }
  }
  // A required text needs the default locale; an optional one that is given in another locale needs it too.
  if ((rules.required || filled.length > 0) && !filled.includes(content.defaultLocale)) {
    issues[`${field}.${content.defaultLocale}`] = issue(
      rules.required ? "banners.form.required" : "errors.reason.default_locale_missing",
    );
  }
  return issues;
}

function windowIssues(
  values: Pick<BannerFormValues, "startsAt" | "endsAt">,
  timeZone: string,
): FormIssues {
  const issues: FormIssues = {};
  const start = localInputToIso(values.startsAt, timeZone);
  const end = localInputToIso(values.endsAt, timeZone);
  if (!start.ok) issues["startsAt"] = issue("banners.form.dateInvalid");
  else if (start.value !== null && !inWindowBounds(start.instant)) {
    issues["startsAt"] = issue("errors.reason.out_of_range");
  }
  if (!end.ok) issues["endsAt"] = issue("banners.form.dateInvalid");
  else if (end.value !== null && !inWindowBounds(end.instant)) {
    issues["endsAt"] = issue("errors.reason.out_of_range");
  }
  if (
    issues["startsAt"] === undefined &&
    issues["endsAt"] === undefined &&
    start.ok &&
    end.ok &&
    start.value !== null &&
    end.value !== null &&
    end.instant <= start.instant
  ) {
    issues["endsAt"] = issue("errors.reason.invalid_window");
  }
  return issues;
}

/**
 * What the form refuses before sending (the API checks the same and more):
 * - a default picture;
 * - `card`: a title in the default locale, every text within its length; `image`: a description in the default locale
 *   (the link's accessible name), within its length;
 * - switched on: the text that names the banner (`card` title, `image` description) in EVERY content locale (plan section
 *   7, "both languages required to activate"), so no shopper sees a banner named in another language;
 * - the link (core `checkBannerLink`) and the window (a real date, end after start, years 2000 to 2199).
 */
export function validateBannerForm(
  values: BannerFormValues,
  content: ContentLocales,
  timeZone: string,
): FormIssues {
  const issues: FormIssues = {};
  if (values.picture === null) issues[pictureField(null)] = issue("banners.form.pictureRequired");
  if (values.layout === "card") {
    Object.assign(
      issues,
      textIssues("title", values.title, content, {
        required: true,
        maxLength: BANNER_LIMITS.titleMaxLength,
      }),
      textIssues("text", values.text, content, {
        required: false,
        maxLength: BANNER_LIMITS.textMaxLength,
      }),
    );
  }
  Object.assign(
    issues,
    textIssues("imageAlt", values.imageAlt, content, {
      required: values.layout === "image",
      maxLength: BANNER_LIMITS.imageAltMaxLength,
    }),
  );
  if (values.isActive) {
    const naming = values.layout === "card" ? "title" : "imageAlt";
    for (const locale of content.locales) {
      const path = `${naming}.${locale}`;
      if ((values[naming][locale] ?? "").trim() === "" && issues[path] === undefined) {
        issues[path] = issue("banners.form.requiredToActivate");
      }
    }
  }
  const link = checkBannerLink(values.link.trim(), content.locales);
  if (!link.ok) issues["link"] = issue(`banners.link.${link.reason}`);
  Object.assign(issues, windowIssues(values, timeZone));
  return issues;
}

export type BannerWarning =
  { kind: "ratio"; locale: string | null; width: number; height: number } | { kind: "ended" };

/**
 * What the form points out without refusing: a picture that is not 2:1 (the storefront crops it) and an end that is
 * already past (the banner will not be shown again).
 */
export function bannerWarnings(
  values: BannerFormValues,
  locales: readonly string[],
  timeZone: string,
  now: number,
): BannerWarning[] {
  const warnings: BannerWarning[] = [];
  const pictures: [string | null, BannerPicture | null | undefined][] = [
    [null, values.picture],
    ...locales.map((locale) => [locale, values.localePictures[locale]] as [string, BannerPicture]),
  ];
  for (const [locale, picture] of pictures) {
    if (picture !== null && picture !== undefined && !hasBannerRatio(picture)) {
      warnings.push({ kind: "ratio", locale, width: picture.width, height: picture.height });
    }
  }
  const end = localInputToIso(values.endsAt, timeZone);
  if (end.ok && end.value !== null && end.instant <= now) warnings.push({ kind: "ended" });
  return warnings;
}

/** The content locales that still show the default picture (the form says so). */
export function localesUsingDefault(
  values: Pick<BannerFormValues, "localePictures">,
  locales: readonly string[],
): string[] {
  return locales.filter((locale) => values.localePictures[locale] === undefined);
}

/** The picture the preview shows for `locale`: its own, else the default one (core `resolveBannerPicture`). */
export function pictureFor(values: BannerFormValues, locale: string): BannerPicture | null {
  return values.localePictures[locale] ?? values.picture;
}

// ------------------------------------------------------------------ request bodies

interface FullBody {
  layout: AdminHomeBannerLayout;
  title: LocalizedText | null;
  text: LocalizedText | null;
  imageAlt: LocalizedText | null;
  imageUploadId: string;
  images: { locale: string; imageUploadId: string }[];
  link: string;
  tone: AdminHomeBannerTone;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

function instantOrNull(text: string, timeZone: string): string | null {
  const result = localInputToIso(text, timeZone);
  if (!result.ok) throw new RangeError("The form sends only checked dates.");
  return result.value;
}

/** Everything the form states, as the API reads it. Only after `validateBannerForm` found nothing. */
function fullBody(
  values: BannerFormValues,
  locales: readonly string[],
  timeZone: string,
): FullBody {
  if (values.picture === null) throw new RangeError("The form sends only with a picture.");
  const card = values.layout === "card";
  return {
    layout: values.layout,
    title: card ? (optionalLocaleMap(values.title, locales) ?? null) : null,
    text: card ? (optionalLocaleMap(values.text, locales) ?? null) : null,
    imageAlt: optionalLocaleMap(values.imageAlt, locales) ?? null,
    imageUploadId: values.picture.uploadId,
    // In the order of the content locales, so `images.N` of a refusal names a known slot (`imageLocalesSent`).
    images: locales.flatMap((locale) => {
      const own = values.localePictures[locale];
      return own === undefined ? [] : [{ locale, imageUploadId: own.uploadId }];
    }),
    link: values.link.trim(),
    tone: values.tone,
    isActive: values.isActive,
    startsAt: instantOrNull(values.startsAt, timeZone),
    endsAt: instantOrNull(values.endsAt, timeZone),
  };
}

export function bannerCreateBody(
  values: BannerFormValues,
  locales: readonly string[],
  timeZone: string,
): CreateAdminHomeBannerBody {
  const body = fullBody(values, locales, timeZone);
  const result: CreateAdminHomeBannerBody = {
    layout: body.layout,
    imageUploadId: body.imageUploadId,
    images: body.images,
    link: body.link,
    tone: body.tone,
    isActive: body.isActive,
  };
  // An `image` banner sends no title or text at all (`not_allowed_for_layout` otherwise).
  if (body.title !== null) result.title = body.title;
  if (body.text !== null) result.text = body.text;
  if (body.imageAlt !== null) result.imageAlt = body.imageAlt;
  if (body.startsAt !== null) result.startsAt = body.startsAt;
  if (body.endsAt !== null) result.endsAt = body.endsAt;
  return result;
}

/**
 * Only what changed. A switch to `image` sends the layout alone for the texts: the API clears the stored title and text
 * itself, and a title in the same request would be refused.
 */
export function bannerPatchBody(
  initial: BannerFormValues,
  values: BannerFormValues,
  locales: readonly string[],
  timeZone: string,
): UpdateAdminHomeBannerBody {
  const before = fullBody(initial, locales, timeZone);
  const after = fullBody(values, locales, timeZone);
  const body = diffForPatch(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
  ) as UpdateAdminHomeBannerBody;
  if (after.layout === "image") {
    delete body.title;
    delete body.text;
  }
  return body;
}

/** The locales of `images` in the order the form sends them (to place an `images.N.*` refusal on its slot). */
export function imageLocalesSent(values: BannerFormValues, locales: readonly string[]): string[] {
  return locales.filter((locale) => values.localePictures[locale] !== undefined);
}

/**
 * The server's refusal on the form: `images.N.imageUploadId` and `images.N.locale` go to the picture slot of the N-th
 * locale sent; everything else as every form does it (`errors[].path` = field name, the rest in the summary).
 */
export function bannerProblemMapper(sentLocales: readonly string[]) {
  return (
    problem: ProblemDetails,
    status: number,
    formFields: readonly string[],
  ): FormErrors<string> => {
    const errors = problem.errors?.map((error) => {
      const match = /^images\.(\d+)\.(imageUploadId|locale)$/.exec(error.path);
      const locale = match === null ? undefined : sentLocales[Number(match[1])];
      return locale === undefined ? error : { ...error, path: pictureField(locale) };
    });
    return formErrorsFromProblem(
      errors === undefined ? problem : { ...problem, errors },
      status,
      formFields,
    );
  };
}
