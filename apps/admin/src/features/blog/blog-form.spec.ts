import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  blogCreateBody,
  blogFieldNames,
  blogFormFrom,
  blogPatchBody,
  blogProblemMapper,
  bodyMap,
  coverFromUpload,
  emptyBlogForm,
  validateBlogForm,
} from "./blog-form";
import { COVER, CONTENT, postFixture } from "./test-fixtures";

const locales = CONTENT.locales;

function problem(overrides: Partial<ProblemDetails> & Record<string, unknown>): ProblemDetails {
  return {
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    code: "validation_failed",
    detail: "The request is not valid.",
    ...overrides,
  };
}

const map = blogProblemMapper("en");
const fields = blogFieldNames(locales);

describe("the post form model", () => {
  it("names every field the way the API's errors[].path does", () => {
    expect(fields).toEqual([
      "slug",
      "title.uk",
      "title.en",
      "excerpt.uk",
      "excerpt.en",
      "body.uk",
      "body.en",
      "seoTitle.uk",
      "seoTitle.en",
      "seoDescription.uk",
      "seoDescription.en",
      "coverUploadId",
      "coverAlt.uk",
      "coverAlt.en",
    ]);
  });

  it("creates a draft with only what was filled in, the body exactly as typed", () => {
    const values = {
      ...emptyBlogForm(locales),
      title: { uk: "  Привіт ", en: "" },
      body: { uk: "\n\n## Вступ  \n", en: "   " },
      excerpt: { uk: "", en: "Short" },
      cover: COVER,
    };
    expect(blogCreateBody(values, locales)).toEqual({
      title: { uk: "Привіт" },
      // Never trimmed: a removed first line would shift the line numbers of a Markdown error.
      body: { uk: "\n\n## Вступ  \n" },
      excerpt: { en: "Short" },
      coverUploadId: COVER.uploadId,
    });
    expect(blogCreateBody({ ...values, slug: " my-post " }, locales).slug).toBe("my-post");
  });

  it("sends a blank body locale as missing, never as an empty string the API refuses", () => {
    expect(bodyMap({ uk: "text", en: " \n " }, locales)).toEqual({ uk: "text" });
  });

  it("patches only what changed; an emptied optional text is null, a removed cover is null", () => {
    const post = postFixture({
      cover: COVER,
      coverUploadId: COVER.uploadId,
      coverAlt: { uk: "Фото" },
    });
    const initial = blogFormFrom(post, locales);
    expect(blogPatchBody(initial, initial, locales, false)).toEqual({});
    const changed = {
      ...initial,
      title: { ...initial.title, en: "First post, edited" },
      excerpt: { uk: "", en: "" },
      coverAlt: { uk: "", en: "" },
      cover: null,
    };
    expect(blogPatchBody(initial, changed, locales, false)).toEqual({
      title: { uk: "Перший допис", en: "First post, edited" },
      excerpt: null,
      coverAlt: null,
      coverUploadId: null,
    });
    // Trailing spaces in a title are not a change; the body's own whitespace is.
    expect(
      blogPatchBody(
        initial,
        { ...initial, title: { ...initial.title, uk: "Перший допис " } },
        locales,
        false,
      ),
    ).toEqual({});
    expect(
      blogPatchBody(
        initial,
        { ...initial, body: { ...initial.body, en: "## Intro\n\nText.\n" } },
        locales,
        false,
      ),
    ).toEqual({ body: { uk: "## Вступ\n\nТекст.", en: "## Intro\n\nText.\n" } });
  });

  it("never sends the slug of a locked post", () => {
    const initial = blogFormFrom(postFixture({ slugLocked: true }), locales);
    const typed = { ...initial, slug: "other" };
    expect(blogPatchBody(initial, typed, locales, true)).toEqual({});
    expect(blogPatchBody(initial, typed, locales, false)).toEqual({ slug: "other" });
  });

  it("takes an uploaded picture as the cover", () => {
    expect(
      coverFromUpload({
        id: COVER.uploadId,
        url: COVER.url,
        contentType: "image/webp",
        byteSize: 10,
        width: 1600,
        height: 900,
        createdAt: "2026-11-13T08:00:00.000Z",
      }),
    ).toEqual(COVER);
  });
});

describe("local checks", () => {
  it("needs the title in the main language only", () => {
    const issues = validateBlogForm(emptyBlogForm(locales), CONTENT, "optional");
    expect(issues).toEqual({ "title.uk": { key: "features.blog.form.titleRequired" } });
    const filled = { ...emptyBlogForm(locales), title: { uk: "Так", en: "" } };
    expect(validateBlogForm(filled, CONTENT, "optional")).toEqual({});
  });

  it("counts characters as the API does (code points of the trimmed text)", () => {
    const base = { ...emptyBlogForm(locales), title: { uk: "😀".repeat(120), en: "" } };
    expect(validateBlogForm(base, CONTENT, "optional")).toEqual({});
    const over = { ...base, seoTitle: { uk: "", en: "x".repeat(71) } };
    expect(validateBlogForm(over, CONTENT, "optional")).toEqual({
      "seoTitle.en": { key: "features.blog.form.tooLong", values: { max: 70 } },
    });
  });

  it("refuses a body over 40 000 UTF-16 units and a slug that breaks the pattern, unless it is locked", () => {
    const values = {
      ...emptyBlogForm(locales),
      title: { uk: "Так", en: "" },
      body: { uk: "x".repeat(40_001), en: "" },
      slug: "Bad Slug",
    };
    expect(validateBlogForm(values, CONTENT, "optional")).toEqual({
      slug: { key: "features.blog.reason.invalid_slug" },
      "body.uk": { key: "features.blog.reason.markdown_too_long" },
    });
    expect(validateBlogForm(values, CONTENT, "locked")).toEqual({
      "body.uk": { key: "features.blog.reason.markdown_too_long" },
    });
    expect(
      validateBlogForm(
        { ...values, body: { uk: "", en: "" }, slug: "a".repeat(161) },
        CONTENT,
        "required",
      ),
    ).toEqual({ slug: { key: "features.blog.form.slugTooLong", values: { max: 160 } } });
  });

  it("refuses an emptied slug on a saved post that is not locked, never on create or a locked one", () => {
    const values = { ...emptyBlogForm(locales), title: { uk: "Так", en: "" }, slug: "  " };
    expect(validateBlogForm(values, CONTENT, "required")).toEqual({
      slug: { key: "features.blog.form.slugRequired" },
    });
    expect(validateBlogForm(values, CONTENT, "optional")).toEqual({});
    expect(validateBlogForm(values, CONTENT, "locked")).toEqual({});
  });
});

describe("refusals on the form", () => {
  it("puts a Markdown error under its locale's body with the API's line", () => {
    // The API's extension members (`line`, `markdownCode`) travel in the entry beside `path` and `code`.
    const entries = [
      {
        path: "body.en",
        code: "markdown_invalid",
        message: "Line 3: heading_level.",
        line: 3,
        markdownCode: "heading_level",
      },
    ];
    const mapped = map(problem({ errors: entries }), 400, fields);
    expect(mapped).toEqual({
      fields: { "body.en": { key: "features.blog.markdown.heading_level", values: { line: 3 } } },
      other: [],
    });
  });

  it("names the reason of a refused link, and keeps an unknown parser code visible", () => {
    const entries = [
      {
        path: "body.uk",
        code: "markdown_invalid",
        line: 7,
        markdownCode: "link_refused",
        reason: "locale_prefix",
      },
      { path: "body.en", code: "markdown_invalid", line: 2, markdownCode: "brand_new_code" },
    ];
    const mapped = map(problem({ errors: entries }), 400, fields);
    expect(mapped.fields["body.uk"]).toEqual({
      key: "features.blog.markdown.link.locale_prefix",
      values: { line: 7 },
    });
    expect(mapped.fields["body.en"]).toEqual({
      key: "features.blog.markdown.unknown",
      values: { line: 2 },
      code: "brand_new_code",
    });
  });

  it("explains the blog's own reasons and the core ones", () => {
    const mapped = map(
      problem({
        errors: [
          { path: "body.uk", code: "markdown_too_long" },
          { path: "slug", code: "invalid_slug" },
          { path: "title.en", code: "too_long" },
          { path: "coverUploadId", code: "upload_not_found" },
        ],
      }),
      400,
      fields,
    );
    expect(mapped.fields).toEqual({
      "body.uk": { key: "features.blog.reason.markdown_too_long" },
      slug: { key: "features.blog.reason.invalid_slug" },
      "title.en": { key: "errors.reason.too_long" },
      coverUploadId: { key: "errors.reason.upload_not_found" },
    });
  });

  it("puts the slug conflict on the slug, and in the summary of a form without one", () => {
    const conflict = problem({
      status: 409,
      code: "conflict",
      field: "slug",
      constraint: "blog_post_slug_key",
    });
    expect(map(conflict, 409, fields)).toEqual({
      fields: { slug: { key: "features.blog.reason.slug_taken" } },
      other: [],
    });
    expect(map(conflict, 409, [])).toEqual({
      fields: {},
      other: [{ key: "features.blog.reason.slug_taken" }],
    });
  });

  it("lists which language misses a title or a body when a publish is refused", () => {
    const refusal = problem({
      status: 409,
      code: "rule_violation",
      rule: "translation_incomplete",
      errors: [
        { path: "title.en", code: "translation_missing" },
        { path: "body.en", code: "translation_missing" },
      ],
    });
    expect(map(refusal, 409, [])).toEqual({
      fields: {},
      other: [
        { key: "features.blog.reason.translation_incomplete" },
        {
          key: "features.blog.reason.translation_missing_title",
          values: { language: "English" },
        },
        { key: "features.blog.reason.translation_missing_body", values: { language: "English" } },
      ],
    });
    // On the edit form (a PATCH of a published post) the same errors land on their fields.
    expect(map(refusal, 409, fields).fields["title.en"]).toEqual({
      key: "features.blog.reason.translation_missing_title",
      values: { language: "English" },
    });
  });

  it("names the language of a stored body that no longer parses when it cannot be put on a field (publish)", () => {
    const entries = [
      { path: "body.en", code: "markdown_invalid", line: 5, markdownCode: "too_deep" },
    ];
    expect(map(problem({ errors: entries }), 400, [])).toEqual({
      fields: {},
      other: [
        { key: "features.blog.reason.bodyInLanguage", values: { language: "English" } },
        { key: "features.blog.markdown.too_deep", values: { line: 5 } },
      ],
    });
  });

  it("explains slug_locked and an unknown problem without fields", () => {
    expect(
      map(problem({ status: 409, code: "rule_violation", rule: "slug_locked" }), 409, fields),
    ).toEqual({
      fields: {},
      other: [{ key: "features.blog.reason.slug_locked" }],
    });
    expect(map(problem({ status: 404, code: "not_found" }), 404, fields)).toEqual({
      fields: {},
      other: [{ key: "errors.code.not_found" }],
    });
  });
});
