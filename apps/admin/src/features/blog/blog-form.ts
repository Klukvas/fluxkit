import type { AdminMediaUpload, FieldError, LocalizedText } from "@fluxkit/api-client";
import { jsonEqual } from "../../lib/diff-for-patch";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";
import type { ContentLocales } from "../../areas/catalog-dictionaries/form-parts";
import { hasText, issue, type FormIssues } from "../../areas/catalog-dictionaries/form-rules";
import {
  languageName,
  localeMapFromValues,
  localeValuesFrom,
  type LocaleValues,
} from "../../areas/catalog-dictionaries/locale-text";
import type { ProblemMapper } from "../../areas/catalog-dictionaries/submit-errors";
import type { BlogCover, BlogPost, CreateBlogPostBody, UpdateBlogPostBody } from "./blog-api";
import {
  BLOG_BODY_MAX_LENGTH,
  BLOG_SLUG_MAX_LENGTH,
  BLOG_SLUG_PATTERN,
  BLOG_TEXT_LIMITS,
  codePoints,
  type BlogTextField,
} from "./blog-rules";

/*
 * The post form as data (pure, tested without React): values per content locale, the local checks, the request bodies and
 * how a refusal lands on the fields. A Markdown refusal names its line (`body.<locale>`, extension members `line`,
 * `markdownCode`, `reason`); the admin never parses Markdown itself.
 */

export const TEXT_FIELDS = ["title", "excerpt", "seoTitle", "seoDescription", "coverAlt"] as const;

export interface BlogFormValues {
  slug: string;
  title: LocaleValues;
  excerpt: LocaleValues;
  body: LocaleValues;
  seoTitle: LocaleValues;
  seoDescription: LocaleValues;
  coverAlt: LocaleValues;
  cover: BlogCover | null;
}

export function emptyBlogForm(locales: readonly string[]): BlogFormValues {
  const blank = localeValuesFrom(null, locales);
  return {
    slug: "",
    title: blank,
    excerpt: blank,
    body: blank,
    seoTitle: blank,
    seoDescription: blank,
    coverAlt: blank,
    cover: null,
  };
}

export function blogFormFrom(post: BlogPost, locales: readonly string[]): BlogFormValues {
  return {
    slug: post.slug,
    title: localeValuesFrom(post.title, locales),
    excerpt: localeValuesFrom(post.excerpt, locales),
    body: localeValuesFrom(post.body, locales),
    seoTitle: localeValuesFrom(post.seoTitle, locales),
    seoDescription: localeValuesFrom(post.seoDescription, locales),
    coverAlt: localeValuesFrom(post.coverAlt, locales),
    cover: post.cover,
  };
}

export function coverFromUpload(upload: AdminMediaUpload): BlogCover {
  return { uploadId: upload.id, url: upload.url, width: upload.width, height: upload.height };
}

/** The form's field names, equal to the `errors[].path` the API answers. */
export function blogFieldNames(locales: readonly string[]): string[] {
  const perLocale = (field: string) => locales.map((locale) => `${field}.${locale}`);
  return [
    "slug",
    ...perLocale("title"),
    ...perLocale("excerpt"),
    ...perLocale("body"),
    ...perLocale("seoTitle"),
    ...perLocale("seoDescription"),
    "coverUploadId",
    ...perLocale("coverAlt"),
  ];
}

/**
 * The bodies to send: a locale with any non-blank text, sent exactly as typed. Never trimmed: a removed first blank line
 * would shift every line number of a Markdown error against the text area.
 */
export function bodyMap(values: LocaleValues, locales: readonly string[]): LocalizedText {
  const map: LocalizedText = {};
  for (const locale of locales) {
    const text = values[locale] ?? "";
    if (hasText(text)) map[locale] = text;
  }
  return map;
}

/**
 * How the slug field is checked: on create an empty slug is made from the title by the API (`optional`); a saved post keeps
 * one (`required`: an emptied field is refused here, it would send `""`); a locked slug is never sent (`locked`).
 */
export type SlugRule = "optional" | "required" | "locked";

/** Local checks before a save (the API checks again): required title, lengths, the slug. */
export function validateBlogForm(
  values: BlogFormValues,
  content: ContentLocales,
  slugRule: SlugRule,
): FormIssues {
  const issues: FormIssues = {};
  const slug = values.slug.trim();
  if (slugRule === "required" && slug === "") {
    issues["slug"] = issue("features.blog.form.slugRequired");
  } else if (slugRule !== "locked" && slug !== "") {
    if (slug.length > BLOG_SLUG_MAX_LENGTH) {
      issues["slug"] = issue("features.blog.form.slugTooLong", { max: BLOG_SLUG_MAX_LENGTH });
    } else if (!BLOG_SLUG_PATTERN.test(slug)) {
      issues["slug"] = issue("features.blog.reason.invalid_slug");
    }
  }
  if (!hasText(values.title[content.defaultLocale] ?? "")) {
    issues[`title.${content.defaultLocale}`] = issue("features.blog.form.titleRequired");
  }
  for (const field of TEXT_FIELDS) {
    const limit = BLOG_TEXT_LIMITS[field as BlogTextField];
    for (const locale of content.locales) {
      const text = (values[field][locale] ?? "").trim();
      if (codePoints(text) > limit) {
        issues[`${field}.${locale}`] = issue("features.blog.form.tooLong", { max: limit });
      }
    }
  }
  for (const locale of content.locales) {
    if ((values.body[locale] ?? "").length > BLOG_BODY_MAX_LENGTH) {
      issues[`body.${locale}`] = issue("features.blog.reason.markdown_too_long");
    }
  }
  return issues;
}

function optionalMap(values: LocaleValues, locales: readonly string[]): LocalizedText | undefined {
  const map = localeMapFromValues(values, locales);
  return Object.keys(map).length === 0 ? undefined : map;
}

export function blogCreateBody(
  values: BlogFormValues,
  locales: readonly string[],
): CreateBlogPostBody {
  const body: CreateBlogPostBody = { title: localeMapFromValues(values.title, locales) };
  const slug = values.slug.trim();
  if (slug !== "") body.slug = slug;
  const bodies = bodyMap(values.body, locales);
  if (Object.keys(bodies).length > 0) body.body = bodies;
  for (const field of ["excerpt", "seoTitle", "seoDescription", "coverAlt"] as const) {
    const map = optionalMap(values[field], locales);
    if (map !== undefined) body[field] = map;
  }
  if (values.cover !== null) body.coverUploadId = values.cover.uploadId;
  return body;
}

/** Only what changed since `initial` (the last saved state); an emptied optional text is `null`. */
export function blogPatchBody(
  initial: BlogFormValues,
  values: BlogFormValues,
  locales: readonly string[],
  slugLocked: boolean,
): UpdateBlogPostBody {
  const patch: UpdateBlogPostBody = {};
  if (!slugLocked && values.slug.trim() !== initial.slug.trim()) patch.slug = values.slug.trim();
  const title = localeMapFromValues(values.title, locales);
  if (!jsonEqual(title, localeMapFromValues(initial.title, locales))) patch.title = title;
  const bodies = bodyMap(values.body, locales);
  if (!jsonEqual(bodies, bodyMap(initial.body, locales))) patch.body = bodies;
  for (const field of ["excerpt", "seoTitle", "seoDescription", "coverAlt"] as const) {
    const map = optionalMap(values[field], locales);
    if (!jsonEqual(map, optionalMap(initial[field], locales))) patch[field] = map ?? null;
  }
  const cover = values.cover?.uploadId ?? null;
  if (cover !== (initial.cover?.uploadId ?? null)) patch.coverUploadId = cover;
  return patch;
}

// ------------------------------------------------------------------ refusals

/** The reasons of the blog routes this slice explains itself (`features.blog.reason.*`). */
export const BLOG_REASONS = [
  "invalid_slug",
  "empty_slug",
  "slug_locked",
  "translation_incomplete",
  "translation_missing",
  "markdown_too_long",
] as const;

/** The parser's error codes (`MarkdownErrorCode`, `docs/contracts/markdown.md`), each with a line message. */
export const MARKDOWN_CODES = [
  "control_character",
  "heading_level",
  "empty_heading",
  "unclosed_code_fence",
  "link_refused",
  "empty_link_text",
  "too_long",
  "too_many_blocks",
  "too_deep",
  "too_many_links",
  "too_many_nodes",
  "too_large",
] as const;

/** Why a link target is refused (`MarkdownLinkRefusal`). */
export const MARKDOWN_LINK_REASONS = [
  "empty",
  "too_long",
  "invalid_characters",
  "not_path_or_https",
  "protocol_relative",
  "dot_segment",
  "locale_prefix",
  "credentials",
  "control_character",
  "bidi_control",
  "format_character",
] as const;

function includes(list: readonly string[], value: unknown): value is string {
  return typeof value === "string" && list.includes(value);
}

/** One `errors[]` entry of a blog route in the form's words (`uiLocale` names a missing translation's language). */
export function describeBlogFieldError(
  entry: Readonly<Record<string, unknown>>,
  uiLocale: string,
): MessageDescriptor {
  const code = typeof entry["code"] === "string" ? entry["code"] : "";
  const path = typeof entry["path"] === "string" ? entry["path"] : "";
  if (code === "translation_missing") {
    const [field, locale] = path.split(".");
    if ((field === "title" || field === "body") && locale !== undefined) {
      return {
        key: `features.blog.reason.translation_missing_${field}`,
        values: { language: languageName(locale, uiLocale) },
      };
    }
  }
  if (code === "markdown_invalid") {
    const line = typeof entry["line"] === "number" ? entry["line"] : 1;
    const markdownCode = entry["markdownCode"];
    const reason = entry["reason"];
    if (markdownCode === "link_refused" && includes(MARKDOWN_LINK_REASONS, reason)) {
      return { key: `features.blog.markdown.link.${reason}`, values: { line } };
    }
    if (includes(MARKDOWN_CODES, markdownCode)) {
      return { key: `features.blog.markdown.${markdownCode}`, values: { line } };
    }
    return {
      key: "features.blog.markdown.unknown",
      values: { line },
      code: typeof markdownCode === "string" ? markdownCode : code,
    };
  }
  if (includes(BLOG_REASONS, code)) return { key: `features.blog.reason.${code}` };
  return describeFieldError(code);
}

/**
 * A refusal of a blog save on the form: each `errors[].path` on its field (a Markdown error with its line), the slug
 * conflict on the slug field, the rules (`slug_locked`, `translation_incomplete`) in the summary in the blog's words.
 */
export function blogProblemMapper(uiLocale: string): ProblemMapper {
  return (problem, status, formFields) => {
    const fields: Partial<Record<string, MessageDescriptor>> = {};
    const other: MessageDescriptor[] = [];
    if (problem.code === "conflict" && problem.field === "slug") {
      const taken = { key: "features.blog.reason.slug_taken" };
      return formFields.includes("slug")
        ? { fields: { slug: taken }, other }
        : { fields, other: [taken] };
    }
    if (problem.code === "rule_violation" && includes(BLOG_REASONS, problem.rule)) {
      other.push({ key: `features.blog.reason.${problem.rule}` });
    } else if (problem.errors === undefined || problem.errors.length === 0) {
      other.push(describeProblem(status, problem));
    }
    for (const entry of problem.errors ?? []) {
      const descriptor = describeBlogFieldError(errorMembers(entry), uiLocale);
      const field = formFields.find((name) => name === entry.path);
      if (field === undefined) {
        // Outside the form (the publish panel: a stored body that no longer parses) the line alone would not say which
        // language's text it is in.
        const language = markdownLanguage(entry);
        if (language !== null) {
          other.push({
            key: "features.blog.reason.bodyInLanguage",
            values: { language: languageName(language, uiLocale) },
          });
        }
        other.push(descriptor);
      } else if (fields[field] === undefined) fields[field] = descriptor;
    }
    return { fields, other };
  };
}

/** The locale of a Markdown refusal of a body (`body.<locale>`), or `null` for any other entry. */
function markdownLanguage(entry: FieldError): string | null {
  const match = /^body\.([^.]+)$/.exec(entry.path);
  return match !== null && entry.code.startsWith("markdown_") ? (match[1] ?? null) : null;
}

/** An `errors[]` entry with the extension members the client's type does not name (`line`, `markdownCode`, `reason`). */
function errorMembers(entry: FieldError): Readonly<Record<string, unknown>> {
  return { ...entry };
}
