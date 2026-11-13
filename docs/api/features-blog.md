# API: blog feature

Optional feature `blog` (`FEATURES_ENABLED`, off by default). Plan `docs/plans/2026-11-13-blog.md` (sections 5 to 8), package
`packages/features/blog` (README: table, removal). With the flag off none of these routes exists: `404` like an unknown path. Not part
of `docs/api/openapi.json`, which lists core routes only. Errors are `application/problem+json` (`docs/api/catalog.md`, Conventions).

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /store/blog/posts` | public | Public posts written in the locale, newest first (`publishedAt`, then id) | query `locale` (a configured locale; missing = `DEFAULT_LOCALE`), `page` (>= 1, default 1), `limit` (1 to 50, default 12); `(page - 1) * limit` at most 10 000; unknown parameters are `400` | `200 {items: [store post summary], total, page, limit}` | 400 (`invalid_value` at `locale`, `too_big` at `page`) | `blog` |
| `GET /store/blog/posts/{slug}` | public | One public post, its body parsed again on this read | query `locale` | `200` store post | 400 (`locale`); 404 `not_found`, one body for an unknown slug, a draft, a scheduled post, a post not written in the locale and a body that no longer parses | `blog` |
| `GET /store/blog/sitemap` | public | The public posts for the storefront sitemap, newest first, at most 5 000 | none | `200 {items: [{slug, updatedAt, locales}], truncated}` | 400 (unknown parameter) | `blog` |
| `GET /admin/blog/posts` | admin `catalog.read` | Every post with its state, the most recently updated first | query `status` (`draft`, `scheduled`, `published`), `page` (>= 1), `limit` (1 to 100, default 50) | `200 {items: [admin post summary], total, page, limit}` | 400 | `blog` |
| `GET /admin/blog/posts/{id}` | admin `catalog.read` | One post: every locale, the Markdown sources, the cover | path `id` | `200` admin post | 400 (`id`), 404 | `blog` |
| `POST /admin/blog/posts` | admin `catalog.write` | Create a draft | body below (`title` required) | `201` admin post, `Location: /admin/blog/posts/{id}` | 400 (below), 409 `conflict` at `slug` | `blog` |
| `PATCH /admin/blog/posts/{id}` | admin `catalog.write` | Change the given fields | any body field; a locale map replaces the whole map, `null` clears an optional one | `200` admin post | 400, 404, 409 `conflict` at `slug`, 409 `rule_violation` `slug_locked` / `translation_incomplete` | `blog` |
| `POST /admin/blog/posts/{id}/publish` | admin `catalog.publish` | Publish now, at the stored date, or at a given (also future: scheduled) date | `{publishedAt?}` or no body | `200` admin post | 400 (`out_of_range` at `publishedAt`, `markdown_invalid` for a stored body that no longer parses), 404, 409 `rule_violation` `translation_incomplete` | `blog` |
| `POST /admin/blog/posts/{id}/unpublish` | admin `catalog.publish` | Back to draft; the date is kept | none | `200` admin post | 400 (`id`), 404 | `blog` |
| `DELETE /admin/blog/posts/{id}` | admin `catalog.write` | Delete a post; its cover upload and file stay | path `id` | `204` | 400 (`id`), 404 | `blog` |

Admin routes follow the `/admin` rules: signed out `401`, a role without the permission `403`, the `X-Fluxkit-CSRF: 1` header on
writes, `Cache-Control: no-store`. Store routes set no cookie and no `Cache-Control`.

## Shapes

- Request body (create and PATCH; strict, an unknown field is `400 unknown_field`): `slug` (optional on create: generated from the
  default-locale title, `-2`, `-3` on a collision), `title`, `excerpt`, `body`, `seoTitle`, `seoDescription`, `coverAlt` (locale maps
  `{"uk": "...", "en": "..."}`; `excerpt`, `seoTitle`, `seoDescription`, `coverAlt` may be `null`), `coverUploadId` (an upload id from
  `POST /admin/media/uploads`, or `null`).
- Admin post summary: `{id, slug, status, state, title, publishedAt, createdAt, updatedAt}`; `status` is `draft` or `published`, `state`
  is `draft`, `scheduled` (published, date ahead) or `published`. Admin post adds `{slugLocked, excerpt, body, seoTitle, seoDescription,
  coverUploadId, cover: {uploadId, url, width, height} | null, coverAlt}` (every locale, the Markdown sources). Times are UTC ISO 8601.
- Store post summary: `{slug, title, excerpt, publishedAt, updatedAt, cover: {url, width, height, alt} | null}`. Store post adds
  `{seoTitle, seoDescription, content, locales}`: `content` is the `MarkdownDocument` AST of the locale's body (`docs/contracts/markdown.md`),
  never HTML; `locales` are the content locales the post is written in (title and body), its hreflang alternates. Texts are the locale's own
  (`null` when absent, never another language); `alt: null` is a decorative picture. Never returned: the status, ids, upload ids,
  `createdAt`, other locales' texts.
- Sitemap item: `locales` as on the store post (a post written in no configured locale is left out). `truncated: true` when more than
  5 000 posts are public: the newest 5 000 are listed and the API logs a warning with the count.

## Rules

- Texts (core `validateI18nText`, codes `required`, `default_locale_missing`, `locale_not_allowed`, `not_a_string`, `empty`, `too_long`,
  `invalid_characters` at `<field>.<locale>`): `title` required with the default locale on create, at most 120 characters; `excerpt` 300,
  `seoTitle` 70, `seoDescription` 160, `coverAlt` 150 (absent = decorative cover).
- `body`: any subset of the content locales (`locale_not_allowed` otherwise), each a Markdown source in "Fluxkit Markdown" (ADR 0050) of at
  most 40 000 characters. Refused bodies: `markdown_too_long` or `markdown_invalid` at `body.<locale>`, with extra members `line` (1-based),
  `markdownCode` (the parser's `MarkdownErrorCode`) and, for `link_refused`, `reason`; `message` is `Line N: <code> (<reason>).`. A lone
  surrogate is `invalid_characters`.
- `slug`: core slug pattern, at most 160 (`invalid_slug`); `empty_slug` when none can be generated from the title; unique for every locale
  (`409 conflict`, `field: slug`). Locked once the post was first published (`409 rule_violation`, `rule: slug_locked`), also back in draft.
- Publish: needs a title and a body in every content locale (`409 rule_violation`, `rule: translation_incomplete`, `errors[]` with
  `translation_missing` at `title.<locale>` / `body.<locale>`); a PATCH of a published post is checked the same way. Every stored body must
  still parse. `publishedAt` in [2000-01-01, 2200-01-01) (`out_of_range`); without it the stored date, else now. Unpublish keeps the date,
  so publishing again keeps it.
- Public = published and `publishedAt <= now`, served in a locale only when the post has a title and a body there. A store read parses the
  body again with the current rules: one that no longer parses answers `404` and the API logs the post id, locale, code and line. The list
  and the sitemap do not parse bodies, so they may still name such a post until it is fixed in the admin.
- Cover: the upload is marked attached in the save's transaction before the row is written (`MEDIA_PORT`); an unknown id is `400
  validation_failed` with `upload_not_found` at `coverUploadId`. The foreign key (ON DELETE RESTRICT) keeps a used upload from being deleted.
- No audit entry and no domain event (like banners and catalog edits). Rate limits: none on the store routes (the known launch blocker of
  the plain catalog store routes).

## Known limits

- The API's JSON request body limit (100 kB, the Express default) is lower than two full-length bodies in a non-Latin script: a request
  with two 40 000-character Cyrillic bodies answers `413` (one fits). As `body` is replaced as a whole map, a post cannot hold two such
  bodies today (Latin text fits: one byte per character). Raising the limit for these routes is a core change, not made here.
