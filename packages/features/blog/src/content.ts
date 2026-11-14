import type { FieldError, LocaleConfig } from "@fluxkit/api-kit";
import {
  hasJsonbUnsafeCharacters,
  parseMarkdown,
  validateI18nText,
  validateSlug,
  type MarkdownErrorCode,
  type MarkdownLinkRefusal,
} from "@fluxkit/core";
import { BLOG_LIMITS } from "./rules.js";

/*
 * The content rules of a post that depend on configuration: the locale maps (core `validateI18nText` with the shop's
 * locales), the slug (core `validateSlug`) and the Markdown bodies (core `parseMarkdown`, ADR 0050). Each returns field
 * errors; an empty array means valid.
 */

/**
 * A Markdown error of one body. Besides the usual `path`, `code` (`markdown_invalid` or `markdown_too_long`) and `message`,
 * it carries the 1-based `line`, the parser's `markdownCode` and, for a refused link, its `reason`, so the admin form shows
 * "line N: <reason>" under the body of that locale (docs/api/features-blog.md).
 */
export interface MarkdownFieldError extends FieldError {
  readonly line: number;
  readonly markdownCode: MarkdownErrorCode;
  readonly reason?: MarkdownLinkRefusal;
}

interface TextRule {
  readonly maxLength: number;
  readonly required: boolean;
}

/** The optional locale maps of a post and their length limits (plan section 5). */
export const OPTIONAL_TEXT_RULES = Object.freeze({
  excerpt: { maxLength: BLOG_LIMITS.excerptMaxLength, required: false },
  seoTitle: { maxLength: BLOG_LIMITS.seoTitleMaxLength, required: false },
  seoDescription: { maxLength: BLOG_LIMITS.seoDescriptionMaxLength, required: false },
  coverAlt: { maxLength: BLOG_LIMITS.coverAltMaxLength, required: false },
} satisfies Record<string, TextRule>);

export const TITLE_RULE: TextRule = Object.freeze({
  maxLength: BLOG_LIMITS.titleMaxLength,
  required: true,
});

export function textErrors(
  path: string,
  value: unknown,
  rule: TextRule,
  locale: LocaleConfig,
): FieldError[] {
  const result = validateI18nText(value, { ...locale, ...rule });
  if (result.ok) return [];
  return result.errors.map((error) => ({
    path: error.locale === undefined ? path : `${path}.${error.locale}`,
    code: error.reason,
    ...(error.limit === undefined
      ? {}
      : {
          message: `${error.reason === "too_long" ? "At most" : "At least"} ${error.limit} characters.`,
        }),
  }));
}

export function slugErrors(slug: string): FieldError[] {
  const checked = validateSlug(slug);
  if (checked.ok) return [];
  return [
    {
      path: "slug",
      code: "invalid_slug",
      message: `Use lowercase letters, digits and single hyphens, at most 160 characters (${checked.reason}).`,
    },
  ];
}

/** The error of one body in one locale, or `undefined` when it parses (an empty body parses: drafts may be partial). */
export function markdownError(
  path: string,
  source: string,
  locales: readonly string[],
): MarkdownFieldError | FieldError | undefined {
  if (hasJsonbUnsafeCharacters(source) && !source.includes("\u0000")) {
    // A lone surrogate cannot be stored in jsonb; NUL is the parser's own `control_character` with its line.
    return { path, code: "invalid_characters" };
  }
  const parsed = parseMarkdown(source, { locales });
  if (parsed.ok) return undefined;
  const { code, line, reason } = parsed.error;
  return {
    path,
    code: code === "too_long" ? "markdown_too_long" : "markdown_invalid",
    message: `Line ${String(line)}: ${code}${reason === undefined ? "" : ` (${reason})`}.`,
    line,
    markdownCode: code,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * The bodies: a map of content locales to Markdown sources, each one at most 40 000 characters and parsing under the rules
 * of ADR 0050. Unlike the title, the default locale is not required: a draft may hold any subset (publishing needs all).
 */
export function bodyErrors(
  body: Readonly<Record<string, string>>,
  locale: LocaleConfig,
): FieldError[] {
  return Object.entries(body).flatMap(([key, source]): FieldError[] => {
    const path = `body.${key}`;
    if (!locale.locales.includes(key)) return [{ path, code: "locale_not_allowed" }];
    const error = markdownError(path, source, locale.locales);
    return error === undefined ? [] : [error];
  });
}
