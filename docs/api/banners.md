# Home banners API

Core module, no feature flag (ADR 0046, plan `docs/plans/2026-11-05-admin-home-banners.md`). Code: `apps/api/src/banners/`, rules
`packages/core/src/content/`. Errors are `application/problem+json` (`docs/api/catalog.md`, Conventions).

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /store/banners` | public | The banners live now: active and inside their window, at most 3, by `position` then `id` | query `locale` (optional, a configured locale; missing = `DEFAULT_LOCALE`); unknown parameters are `400` | `200 {items: [{id, layout, title, text, href, tone, image: {url, width, height, alt}}]}` | 400 (`invalid_value` at `locale`) | - |
| `GET /admin/banners` | admin `catalog.read` | Every banner (at most 50), by `position` then `id` | none | `200 {items: [banner]}` | - | - |
| `POST /admin/banners` | admin `catalog.write` | Create a banner, appended at the end | body below (`imageUploadId` and `link` required) | `201` banner, `Location` | 400 (see below), 409 `rule_violation` `too_many_banners` | - |
| `PUT /admin/banners/order` | admin `catalog.write` | Reorder: positions become 0..n-1 in the given order | `{ids: uuid[]}`, exactly the current banners, each once | `200 {items: [banner]}` | 400 (`order_mismatch` at `ids`) | - |
| `GET /admin/banners/{id}` | admin `catalog.read` | One banner | path `id` | `200` banner | 400, 404 | - |
| `PATCH /admin/banners/{id}` | admin `catalog.write` | Change the given fields | any body field; `null` clears `title`, `text`, `imageAlt`, `startsAt`, `endsAt`; `images` replaces the whole set | `200` banner | 400 (see below), 404 | - |
| `DELETE /admin/banners/{id}` | admin `catalog.write` | Delete a banner and its own pictures; the uploads and files stay | path `id` | `204` | 400, 404 | - |

## Shapes

- Request body: `layout` (`card` default, or `image`), `title`, `text`, `imageAlt` (locale maps or `null`), `imageUploadId` (the default
  picture, an upload id from `POST /admin/media/uploads`), `images` (`[{locale, imageUploadId}]`, own pictures per content locale, default
  `[]`), `link`, `tone` (`surface` default, or `accent`), `isActive` (default `false`), `startsAt`, `endsAt` (ISO 8601 with `Z` or an offset,
  or `null`). Strict: an unknown field is `400 unknown_field`.
- Admin banner: `{id, layout, title, text, imageAlt, image: {uploadId, url, width, height}, images: [{locale, uploadId, url, width,
  height}], link, tone, position, isActive, startsAt, endsAt, state, shownOnStorefront, createdAt, updatedAt}`. `state` is `live`,
  `scheduled` (before `startsAt`), `expired` (from `endsAt` on) or `inactive`; `shownOnStorefront` marks the first 3 live banners. Times are
  UTC. `url` is `MEDIA_PUBLIC_BASE_URL/<key>`.
- Store banner: `title` and `text` are `null` for `layout: image`; `alt` is `null` for a decorative `card` picture. Texts fall back per field
  to the default locale. `image` is the locale's own picture, else the default one (never another locale's own picture). Never returned:
  the active flag, the window, the position, timestamps, upload ids.

## Rules (core `packages/core/src/content`)

- `layout: card`: `title` required in the default locale (1 to 80 characters), `text` up to 200, `imageAlt` up to 150 (absent = a
  decorative picture). `layout: image`: `imageAlt` required in the default locale (it is the link's accessible name), `title` and `text`
  must be absent (`not_allowed_for_layout`); switching a stored banner to `image` clears them. Text errors use the i18n codes
  (`required`, `default_locale_missing`, `locale_not_allowed`, `empty`, `too_long`, `invalid_characters`) at `title.<locale>` and so on.
- `link` (`400 invalid_link` at `link`): a storefront path without the locale prefix (one leading `/`, no `//`, no `.`/`..` segment, also
  not as `%2e`, no leading `/uk/`, `/en/`) or an `https://` address with a host and no credentials; no whitespace, control character or
  backslash; at most 2048 characters. `http:`, `javascript:`, `data:`, `mailto:` and relative paths are refused.
- Window: half-open `[startsAt, endsAt)`, `null` = open; `endsAt` must be after `startsAt` (`invalid_window` at `endsAt`); instants between
  2000-01-01 and 2200-01-01 (`out_of_range`).
- Pictures: every id must name an upload (`upload_not_found` at `imageUploadId` or `images.N.imageUploadId`); the default and every own
  picture are marked attached in the save's transaction (`docs/api/media.md`, attach marking), so job 7 never deletes them. A replaced or
  removed picture is no longer referenced but stays attached with its file (no purge, a known media gap). `images.N.locale` must be a
  content locale (`locale_not_allowed`) and appear once (`duplicate`). The foreign keys refuse deleting an upload row a banner uses.
- At most 50 banners are stored; the 51st create is `409 rule_violation` `too_many_banners`, checked under a transaction advisory lock (also
  taken by the reorder), so concurrent creates never exceed it.

## Notes

- Caching: `GET /store/banners` sends no `Cache-Control` and no cookie, like `GET /store/categories`; the storefront caches it 60 s, so a
  start or end time takes effect up to 60 s late. No rate limit (same gap as the other catalog store routes).
- Known gap: banner writes record no audit event (owner decision 2026-11-05, like catalog and brand edits, `docs/api/audit.md`) and emit no
  domain event.
- The texts are public marketing copy: do not type personal data into them (privacy inventory row D24).
