# @fluxkit/feature-blog

Purpose: an optional blog. Admins with the catalog permissions write posts (title, excerpt, Markdown body, SEO title and description,
cover picture and its alt text, per content locale), keep them as drafts, publish, schedule (a future `publishedAt`), unpublish and delete
them; the store API serves the public posts with their body as a parsed Markdown AST, never HTML. Plan: `docs/plans/2026-11-13-blog.md`
(this package is its PR 3: the API part). The storefront pages and the admin screens are separate slices (plan PRs 4b and 5); the
admin slice is `apps/admin/src/features/blog/` (Storefront -> Blog, `apps/admin/README.md`, "Feature slices").

Posts are public shop content: never put personal data in them (no author, no names of staff or customers).

- Flag: `blog` in `FEATURES_ENABLED` (off by default; owner's answer 9 (a)). Off: no route (every `/store/blog/*` and `/admin/blog/*`
  answers `404` like an unknown path), no migration, no database write; `features` of `GET /store/config` and `GET /admin/config` lacks
  `blog`.
- Manifest: `"fluxkit": {"feature": "blog"}` in `package.json`. Entry `src/index.ts`: `featureModule` and `personalDataInventory`.
- Routes: `docs/api/features-blog.md` (store: list, one post, sitemap; admin: list, get, create, change, publish, unpublish, delete).
  Not in `docs/api/openapi.json` (core routes only).
- Permissions (owner's answer 7 (a)): `catalog.read` to read, `catalog.write` to create, change and delete, `catalog.publish` to publish
  and unpublish. No role table change, no audit or domain events.

## Extension points used (ADR 0049, `docs/contracts/README.md`, "Feature extension points")

- `@fluxkit/api-kit`: `ProblemException` (every error), `AdminController` and `RequirePermission` (the admin routes; the API's global
  guard enforces them, default deny), `FEATURE_DATABASE` (the API's Drizzle instance), `MEDIA_PORT` (the cover: attached in the save's
  transaction before the row is written, described for the answers), `LOCALE_CONFIG` (the content locales).
- `@fluxkit/core`: `validateI18nText`, `validateSlug`, `slugLookupPrefix`, `generateUniqueSlug`, `parseMarkdown` (ADR 0050, safe
  Markdown), `checkPersonalDataInventory`.
- Feature migrations: `drizzle.config.ts`, `src/schema.ts`, `drizzle/` with its own journal, applied by `pnpm db:migrate` when the flag is
  on and recorded in `drizzle.__drizzle_migrations_feature_blog`. The API refuses to start while the flag is on and the migration is
  missing: enable the feature with `FEATURES_ENABLED=blog`, `pnpm db:migrate`, then start the API.

## Database

Table `blog_post` (migration `drizzle/0000_blog_post.sql`, rollback `drizzle/0000_blog_post.down.sql`):

| Column | Rule |
|---|---|
| `id` | uuid primary key |
| `slug` | unique (`blog_post_slug_key`), core slug pattern, at most 160; one slug for every locale; locked once the post was first published |
| `status` | `draft` or `published` |
| `published_at` | set on the first publish (default now, or an instant in [2000, 2200)); kept on unpublish; required when published |
| `title` | locale map, required, the default locale on create, at most 120 characters |
| `excerpt`, `seo_title`, `seo_description`, `cover_alt` | locale maps or null; at most 300, 70, 160 and 150 characters |
| `body` | locale map of Markdown sources (default `{}`), at most 40 000 characters each, must parse (ADR 0050) |
| `cover_upload_id` | uuid or null; foreign key `blog_post_cover_upload_id_fkey` to `media_upload(id)` ON DELETE RESTRICT, added by hand at the end of the migration (ADR 0049; the drift check cannot see it, `src/migration.spec.ts` asserts it) |
| `created_at`, `updated_at` | timestamps; every write sets `updated_at` (the sitemap's last modification) |

Indexes: `blog_post_public_idx` (`published_at DESC, id DESC WHERE status = 'published'`, store list and sitemap),
`blog_post_updated_idx` (`updated_at DESC, id DESC`, admin list). Every locale map has a `jsonb_typeof = 'object'` check.

Public = `status = 'published' AND published_at <= now()`, served in a locale only when the post has a title and a body there. Publishing
needs a title and a body in every content locale (owner's answer 6 (a)).

## Personal data (ADR 0033, `personalDataInventory` in `src/inventory.ts`)

| Table | Columns | Class | Export | Erasure |
|---|---|---|---|---|
| `blog_post` | every column (`id`, `slug`, `status`, `published_at`, `title`, `excerpt`, `body`, `seo_title`, `seo_description`, `cover_upload_id`, `cover_alt`, `created_at`, `updated_at`) | `none` (public shop content, ref `FEATURE-BLOG`) | not applicable | not applicable |

## Tests

`pnpm --filter @fluxkit/feature-blog test`. The unit specs need nothing; the integration specs (`migration`, `admin-blog`, `store-blog`)
need `DATABASE_URL` (a database name ending in `_test`): each creates its own scratch database next to it, applies the core migrations
(read from `apps/api/drizzle`, never imported) and this feature's, and drops it at the end. They run the module with test stand-ins for
the API's host (`src/test/`: a `MEDIA_PORT` over the scratch `media_upload` table and a problem filter with the API's members); the API's
guard, CSRF rule and real problem filter are proven by the core specs with the fixture feature `notebook`.

## Removing the feature

1. Remove `blog` from `FEATURES_ENABLED` and restart the API (the routes are gone; the table stays).
2. If the database ever had the migration, roll it back BEFORE any core down migration (its foreign key references `media_upload`):
   `psql "$DATABASE_URL" -f packages/features/blog/drizzle/0000_blog_post.down.sql`. Every post is lost; cover uploads stay attached
   with their files.
3. Delete this folder, the admin slice `apps/admin/src/features/blog/` (its screens, messages and specs; the admin's feature
   registry then finds no blog and shows no Blog entry) and the storefront slice once it exists, then run `pnpm install` to update the
   lockfile. Nothing else of the admin names the blog.
