# 0046. Home banners managed in the admin: a core module without a flag

Status: accepted (owner decisions 2026-11-05, plan `docs/plans/2026-11-05-admin-home-banners.md`, section 6 answers and section 7
amendments). Builds on ADR 0028 (media upload and attach marking) and ADR 0006 (JSONB locale maps); changes neither. Step 1 of the plan
(this ADR, the schema, the API) was approved by the owner as a red zone (schema, public contract, media attach change).

## Context

- PR 225 added a static `banners` home section (`apps/storefront/src/config/home.ts`): editing banners needs a developer. The owner wants the
  shop owner to manage them in the admin: a picture, texts per content locale, one link, a tone, an active switch and an optional window.
- AGENTS.md section 2.1: optional features live in feature packages behind a flag. A feature package cannot do what banners need today
  (checked, plan D1): no per-feature migrations (`drizzle.config.ts` reads one schema), no permissions (features may not import `apps/api`,
  so no `@RequirePermission`), no attach marking (`MediaAttachService` lives in `apps/api`; without it job 7 deletes the picture after 24 h),
  no privacy inventory entry, no admin route registry and no storefront home slot. Each missing piece is an extension point and a public
  contract of its own.
- Storefront content (hero, trust bar, banners) is already core presentation, controlled by the home config, not by a feature flag.

## Decision

1. **Core module, no feature flag.** API in `apps/api/src/banners/` (admin and store controllers, one repository, no import from other core
   modules except the shared helpers, and no module imports it), pure rules in `packages/core/src/content/`, admin area and storefront
   section in later PRs. Self-contained folders, so moving it into a feature package later is mechanical once the five extension points
   exist (a separate architect plan if ever wanted). Whether banners show is decided by the storefront's home config (`source`), like every
   home section.
2. **Data model (migration `0012_banner`).** Table `banner`: `layout` (`card` | `image`), `title`, `text`, `image_alt` (JSONB locale maps,
   nullable), `image_upload_id` (the default picture, FK `media_upload` RESTRICT), `link`, `tone` (`surface` | `accent`), `position`,
   `is_active`, `starts_at`, `ends_at` (half-open window `[starts_at, ends_at)`, CHECK end after start), timestamps. Table `banner_image`:
   one own picture per content locale (`banner_id` FK CASCADE, `locale`, `image_upload_id` FK RESTRICT, primary key `(banner_id, locale)`).
   A locale without a row shows the default picture; the default locale's own picture is never a fallback for another locale. JSONB maps,
   not a translations table (the repo convention). Pictures are upload ids, not URLs: the foreign keys keep the upload rows, width and
   height come from the upload (no layout shift), and no external image URL is possible.
3. **Rules in core** (`packages/core/src/content`), one definition for the API and the admin form: `checkBannerLink` (a storefront path with
   one leading `/`, no `//`, no `.`/`..` segment even as `%2e`, no leading content-locale segment; or an `https` address with a host and no
   credentials; never whitespace, control characters or a backslash; at most 2048), `checkBannerWindow` (instants in [2000, 2200), end after
   start), `bannerWindowState` and `selectLiveBanners` (live = active and inside the window, by position then id, at most
   `MAX_STORE_BANNERS` = 3), `checkBannerContent` (`card`: title required in the default locale, 1 to 80, text up to 200, alt up to 150;
   `image`: alt required in the default locale because it is the link's accessible name, title and text absent), `checkBannerImageLocales`,
   `resolveBannerPicture`, `checkBannerOrder`, `checkBannerCount` (`MAX_STORED_BANNERS` = 50). Core is pure: the https address is read
   without the `URL` global.
4. **Attach marking by id.** `MediaAttachService.markAttachedByIds` marks every picture of a banner in the save's transaction with the same
   single `UPDATE ... RETURNING` (and row locks) as `markAttached`; an unknown id is `400 upload_not_found` at its field. Ids are checked
   whatever `MEDIA_PUBLIC_BASE_URL` is. A replaced or removed picture is simply no longer referenced; it stays attached, so job 7 never
   deletes it (ADR 0028: attached uploads are never deleted; the known "no purge" gap).
5. **Admin API** under `/admin/banners` with the catalog permission pair (`catalog.read`, `catalog.write`; owner decision 3): list (every
   banner with a computed `state` and `shownOnStorefront`), get, create (appended at the end), PATCH (switching to `image` clears the
   stored title and text), delete (`204`, the uploads stay), `PUT /admin/banners/order` (exactly the current set, else `400 order_mismatch`).
   Creates and reorders hold a transaction advisory lock (`BANNER_LIST_LOCK_KEY`) so the 50 cap (`409 rule_violation` `too_many_banners`)
   and the positions hold under concurrency. Strict request schemas, the usual CSRF header.
6. **Public API** `GET /store/banners?locale=`: live banners only, at most 3, public fields `{id, layout, title, text, href, tone, image:
   {url, width, height, alt}}`; texts fall back per field to the default locale; the picture is resolved for the locale on the server. No
   cookie, no `Cache-Control` (like `GET /store/categories`; the storefront caches 60 s, so a start or end time takes effect up to 60 s
   late). Not part of `GET /store/config` (settings, not locale-dependent content).
7. **No audit event** for banner writes (owner decision 4, like catalog and brand edits) and no domain event; recorded as a known gap.
8. **Privacy.** Both tables hold no personal data (inventory row D24); the texts are public marketing copy and staff must not type
   personal data into them.

## Consequences

- A fork that does not want banners keeps two dormant tables and the routes; it switches the home section to `source: "config"` or removes
  it (no UI, no storefront request).
- The down migration drops `banner_image`, then `banner`; banner rows are lost, their uploads stay attached with their files.
- No rate limit on `GET /store/banners` (the same launch blocker as the other plain catalog store routes, HANDOFF next step 5); one indexed
  query on at most 50 rows plus one for the locale's pictures.
- External links may point anywhere on `https` (owner default 5); a compromised `catalog.write` account can link to a phishing site.
- The storefront does not depend on `@fluxkit/core`; it keeps its own link check with a parity spec over the same case table (PR 3).
