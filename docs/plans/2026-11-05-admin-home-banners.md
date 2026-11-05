# Plan: home page banners managed in the admin

Status: owner decisions 2026-11-05 recorded in section 6 (questions 1 to 4 answered with the recommended defaults; 5 and 6 keep the recommended defaults until the owner says otherwise). PR 1 (API, branch `feature/banners-api`) built after the owner approved its red zones (schema `0012_banner`, the additive contract, `markAttachedByIds`, ADR 0046); not reviewed yet, see section 8. PRs 2 and 3 not started. Owner decision 2026-11-05: the shop owner manages the home banners in the admin instead of
editing `apps/storefront/src/config/home.ts`. Structured banners only (no HTML, no iframes). Follows PR 225
(`docs/plans/2026-11-05-home-banners.md`, "Later option").
Red zones (AGENTS.md section 14): DB schema and migration, public API contract, media attach change. Owner approval is needed before
step 1 starts; the open questions are at the end.

## 1. Goal

- An admin screen where a `catalog.write` admin creates, edits, deletes, orders, schedules and activates home banners: an uploaded
  image (media service, ADR 0028), title, optional text, optional image alt text (each per content locale, `uk`/`en`), one link
  (storefront path or `https` address), a tone (`surface`/`accent`), an active flag, optional start and end time (UTC).
- `GET /store/banners` returns the banners that are live now (active and inside the window), in order, at most 3, public fields only.
- The storefront `banners` home section reads them (`source: "admin"`), keeps the static config mode (`source: "config"`), stays
  hidden when there are none, and never breaks the rest of the page.

## 2. What exists (found, reused)

| Area | What exists (path) | Use here |
|---|---|---|
| Static banners | `apps/storefront/src/config/home.ts` (`BannersSection`, `BannerList` 0 to 3, `MAX_BANNERS = 3`, `BannerTone`), `lib/home-banners.ts` (`bannerLink`, `checkBannersSection`), `components/home-sections.tsx` (`BannersView`, one link per card, `aria-labelledby`/`aria-describedby`), e2e `home-banners.e2e.ts` | Keep the renderer and its a11y; add a data source |
| Home data sections | `lib/home-data.ts` (`loadHomeSectionResult`: one load per section, `StoreUnavailableError`/`UnexpectedStoreResponseError` -> `error`, logged), Suspense per section in `home-sections.tsx` | Banners become a data section when `source: "admin"` |
| Storefront reads | `lib/store-data.ts` (`StoreData`, Next data cache `CATALOG_REVALIDATE_SECONDS = 60`, `STORE_TAGS`, last-good copy on outage), `@fluxkit/api-client` (hand-written, contract tests) | New `listBanners(locale)`, tag `store:banners` |
| Image policy | `lib/image-source.ts` `allowedImageUrl` (https + `STOREFRONT_IMAGE_HOSTS`; dev-only same-origin `/media` rewrite), `components/store-image.tsx` (token placeholder on refusal) | Uploaded banner images go through it, like product images |
| Media upload | `POST /admin/media/uploads` (`catalog.write`, raw body, re-encoded JPEG/PNG/WebP, `201 {id, url, width, height, ...}`), `docs/api/media.md`, ADR 0028 | Banner image = one upload |
| Attach marking | `apps/api/src/media/media-attach.service.ts` `markAttached(db, [{path, url}])` in the save's transaction, `upload_not_found`; job 7 `delete-abandoned-uploads` deletes never-attached uploads after 24 h; attached uploads are never deleted (`docs/api/jobs.md`) | Banner saves must mark their upload, or job 7 deletes the image after 24 h |
| Per-locale texts | JSONB locale maps (`I18nText`, `packages/core/src/catalog/types.ts`), `validateI18nText` (`packages/core/src/catalog/i18n.ts`: default locale required, configured locales only, length, unsafe characters), DB checks `jsonb_typeof = 'object'` (`apps/api/src/database/schema/catalog.ts`), admin `areas/catalog-dictionaries/locale-text.ts` | Same convention; no translations table exists anywhere |
| Admin permissions | `packages/core/src/auth/roles.ts` (fixed table, ADR 0009: owner, manager, viewer), `@RequirePermission` (`apps/api/src/auth/route-access.ts`), global `AdminPathGuard` default deny, `x-fluxkit-permission` in OpenAPI, admin `permissions.ts` reads `ADMIN_OPERATIONS` | Reuse `catalog.read`/`catalog.write` (decision 4) |
| Audit | `docs/api/audit.md`: customer, admin user and privacy actions only; catalog writes are not audited; `admin_audit_event.target_kind` has a CHECK list (`apps/api/src/database/schema/privacy.ts`), actions only a pattern | A banner audit needs a CHECK change (decision 4) |
| Admin UI | Route table `apps/admin/src/routes.ts`, `layout/navigation.ts` ("Internal in v1 (no registry for feature modules yet)"), brand logo upload (`catalog-dictionaries/brand-logo-upload.ts`, `upload-panel.tsx`, `upload-queue.ts`, `config-gate.tsx` with `media.uploadsEnabled`), `form-dialog.tsx`, `submit-errors.ts`, `router/unsaved-changes.ts`, `lib/use-focus-after-commit.ts` | Same patterns in a new area |
| Knowledge base | `apps/admin/src/areas/help/content/` (typed uk/en articles, `screen` block, `help-content.spec.ts`) | One new article |
| Feature packages | `packages/features/_example`, `apps/api/src/features/feature-loader.ts`, `docs/contracts/config.md` "Feature package contract" | Checked for decision 1 |
| Privacy inventory | `apps/api/src/privacy/inventory/tables-no-personal-data.ts` (D24), `schema-tables.ts` + `inventory.spec.ts` (every table must be classified), `docs/privacy/data-inventory.md` (`data-inventory-doc.spec.ts`) | Classify `banner` as no personal data |
| Search | Queue marks only in catalog, price and stock writers (`docs/api/search.md`) | Not touched: banners are not indexed, no queue mark, `search-off`/`search-on` unaffected |
| Migrations | `apps/api/drizzle/0000` to `0011` with hand-written `.down.sql`; `scripts/check-schema-drift.sh` | New `0012_banner` |
| Store caching | `apps/api/src/common/store-path.ts` (`no-store` only on account, cart, checkout, orders, shipping); catalog store routes send no `Cache-Control`; no rate limit on plain catalog store routes (HANDOFF next step 5) | Same as `GET /store/categories` |
| E2E | Storefront suite signs in as admin through the API and uploads media (`apps/storefront/e2e/support/api.ts`, `tests/media-route.e2e.ts`); admin suite tests uploads in a browser (`apps/admin/e2e/tests/media-upload.e2e.ts`) and has no storefront | "Admin creates -> storefront shows" lives in the storefront suite via the API; the admin form in the admin suite |

## 3. Decisions (alternatives, recommendation)

### D1. Core vs optional feature package

| Option | For | Against |
|---|---|---|
| **A. Core (recommended)**: `apps/api/src/banners/`, rules in `packages/core/src/content/`, admin area, storefront section | Every needed piece exists in core today; storefront content is core presentation like the hero and trust bar | A fork that does not want banners keeps a dormant table and routes (it removes the home section; no UI, no storefront request) |
| B. `packages/features/banners` + `FEATURES_ENABLED=banners` | Removable by deleting a folder | Not feasible without new extension points, each a public contract (below) |
| C. Core now, folder kept self-contained so a later move is mechanical | Same as A | Same as A |

What a feature package cannot do today (checked):
- **Migrations**: `drizzle.config.ts` reads one schema (`apps/api/src/database/schema/index.ts`) and `pnpm db:migrate` applies only `apps/api/drizzle/`; no per-feature migration mechanism.
- **Permissions**: features may not import `apps/api`, so they cannot use `@RequirePermission`; a plain admin controller answers `403` to every admin (`docs/contracts/config.md`: "unusable until the extension point for features exists").
- **Media**: `MediaAttachService` lives in `apps/api`; without attach marking job 7 deletes the banner image after 24 h.
- **Privacy inventory**: the CI guard classifies core schema tables only.
- **Admin UI**: the route table and navigation are static, no slot or registry for features (`layout/navigation.ts`).
- **Storefront**: home section kinds are a closed union (`never` check); a feature section needs a slot.

Recommendation: **A, built as C** (one folder per app, no imports of banners from other core modules except the home section and
the admin route table). No flag: the section is controlled by the home config, like every other home section. A feature version needs
five extension points (feature migrations, feature permissions, feature media attach, admin route registry, storefront home slot):
a separate architect plan if the owner wants it. Record the choice in ADR 0046 (step 1).

### D2. Data model (`banner`, migration `0012_banner`)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid pk | |
| `layout` | text not null default `'card'` | CHECK in (`card`, `image`): `card` = picture, title, text, link; `image` = the picture alone (designed in Figma or Canva), with the link (owner decision 2026-11-05) |
| `title` | jsonb `I18nText` null | required for `card` (default locale, 1 to 80 characters, `validateI18nText`); not used for `image` |
| `text` | jsonb `I18nText` null | 0 to 200 |
| `image_alt` | jsonb `I18nText` null | 0 to 150. `card`: absent = decorative picture (`alt=""`, the link's name is the title). `image`: REQUIRED in the default locale: it is the link's accessible name, because the picture is the only content |
| `image_upload_id` | uuid not null, FK `media_upload(id)` ON DELETE RESTRICT | the DEFAULT picture, used for every locale without its own one; width, height and URL come from the upload row |
| `link` | text not null | storefront path or `https` URL, at most 2048, rules below; stored without a locale prefix |
| `tone` | text not null default `'surface'` | CHECK in (`surface`, `accent`) |
| `position` | integer not null | order; rewritten 0..n-1 by the reorder route; no unique constraint (ties ordered by `id`) |
| `is_active` | boolean not null default false | |
| `starts_at`, `ends_at` | timestamptz null | UTC; CHECK `ends_at > starts_at` when both set; window is half-open `[starts_at, ends_at)` |
| `created_at`, `updated_at` | timestamptz not null | |

- **JSONB maps, not a translations table**: the repo convention (catalog, categories, brands, attributes; HANDOFF "texts are JSONB locale maps"), one row read, the existing validator and admin helpers. A translations table has no precedent here.
- **Image as an upload id, not a URL**: integrity by FK (the image cannot vanish), dimensions known (no layout shift), and no foreign-prefix trap (`docs/api/media.md`, L-3). External image URLs are not allowed (local media only). Cost: a small `markAttachedByIds` next to `markAttached` in the media module (same `UPDATE ... RETURNING` lock semantics), red zone because it touches media.
- **Pictures per language (owner decision 2026-11-05)**: a second table `banner_image` (`banner_id` uuid FK `banner(id)` ON DELETE CASCADE, `locale` text, `image_upload_id` uuid not null FK `media_upload(id)` ON DELETE RESTRICT, primary key (`banner_id`, `locale`); the locale must be one of the shop's content locales, checked by the API). A locale without a row shows the default picture (`banner.image_upload_id`, always required). The default locale may have its own row too. Reasons: pictures with text inside are language specific; a table (not a jsonb map) keeps the FK integrity of every upload. Every picture of a banner is marked attached in the same transaction (`markAttachedByIds` takes the id list); replacing or removing a locale picture leaves the old upload attached (CORRECTED in section 8: job 7 only deletes uploads that were never attached). Up to one row per content locale (2 today). Not personal data (privacy inventory: classify the table, no personal columns).
- **Count**: up to 50 rows stored (scheduled and inactive ones too; the admin list needs no paging), at most 3 shown (`MAX_STORE_BANNERS = 3`, same as the storefront `MAX_BANNERS`). The 50 cap is checked in the create transaction under a transaction advisory lock (`409 rule_violation` `too_many_banners`).
- **Link rule (one definition, server and client)**: pure `checkBannerLink(href)` in `packages/core/src/content/banner-link.ts`, the same behaviour as storefront `bannerLink`/`localizedHref`: a path starts with one `/`, no `//`, `\`, `.`/`..` segments; plus the two open PR 225 minors fixed here: percent-encoded dot segments (`%2e`) and a leading locale segment (`/uk/...`, `/en/...`) are refused; an absolute URL must be `https`, have a host, no credentials, no whitespace or control characters, at most 2048. Refused: `http:`, `javascript:`, `data:`, `mailto:`, `//host`, relative paths. The API answers `400 validation_failed` `invalid_link` at `link`. The storefront does not depend on `@fluxkit/core`, so it keeps its own check and a parity spec with the same case table (as `media-limits-parity.spec.ts` does for media limits).
- **Dates**: stored and returned as UTC (`Z`); the API accepts ISO 8601 with `Z` or an offset, years 2000 to 2200 (like the audit filters). The admin form takes local time (`datetime-local`) and shows the time zone; the shop has no configured time zone.

### D3. Public API

- `GET /store/banners?locale=uk` (public, no cookie) -> `200 {items: [{id, layout, title, text, href, tone, image: {url, width, height, alt}}]}` (`image` is the picture of the requested locale, else the default one; `title`/`text` are null for `layout: image`),
  0 to 3 items, live only (`is_active` and `starts_at <= now < ends_at`, null = open), by `position`, `id`. Per-field locale fallback to
  the default locale (contract "Locale handling"); `text` and `alt` may be `null`. Never returned: `isActive`, `startsAt`, `endsAt`,
  `position`, timestamps, upload id. `400` on an unsupported `locale`.
- Not part of `GET /store/config`: config is settings, not locale-dependent content, and its contract says "nothing else".
- Caching: same as `GET /store/categories` (no `Cache-Control` from the API); the storefront caches 60 s in the Next data cache under
  tag `store:banners`. A start or end time therefore takes effect up to 60 s late (accepted, as for catalog pages).
- Rate limit: none, like the other plain catalog store routes (known launch blocker, HANDOFF next step 5). One indexed query on a table of at most 50 rows joined to `media_upload`.
- Image URL: `MEDIA_PUBLIC_BASE_URL/<key>`, built by the API; the storefront still applies `allowedImageUrl`.
- Contract: additive (new route, new schemas); `docs/contracts/api.md` row, `docs/api/banners.md`, `openapi.json`.

### D4. Admin API, permissions, audit

| Route | Permission | Notes |
|---|---|---|
| `GET /admin/banners` | `catalog.read` | all rows (<= 50) by position; each with a computed `state` (`live`, `scheduled`, `expired`, `inactive`) and `shownOnStorefront` (one of the first 3 live) |
| `GET /admin/banners/{id}` | `catalog.read` | `404` unknown |
| `POST /admin/banners` | `catalog.write` | `201`; appended at the end; `400` (`invalid_link`, `upload_not_found` at `imageUploadId`, i18n codes, `invalid_window`), `409 too_many_banners` |
| `PATCH /admin/banners/{id}` | `catalog.write` | partial; same validation |
| `DELETE /admin/banners/{id}` | `catalog.write` | `204`; the upload and its file stay (media rule: attached uploads are never deleted) |
| `PUT /admin/banners/order` | `catalog.write` | `{ids: uuid[]}` must be exactly the current set, else `400` `order_mismatch`; rewrites positions in one transaction |

- Strict request schemas (unknown fields `400`), `X-Fluxkit-CSRF: 1`, `no-store` (existing `/admin` middleware), `x-fluxkit-permission` generated.
- **Permission (recommended: reuse `catalog.read`/`catalog.write`)**: the image upload already needs `catalog.write`; banners are merchandising like brands; owner and manager edit, viewer reads. Alternative: new `content.manage` (changes the role table and the auth contract, red zone); only worth it if a fork needs a marketing-only role.
- **Audit (recommended: none in v1)**: catalog and brand writes are not audited; the audit log covers personal-data and staff actions. Alternative: actions `banner.created|updated|deleted|reordered` with target kind `banner` (needs the `admin_audit_event` target kind CHECK changed in `0012`, and the core action list); record as a gap in `docs/api/audit.md`.
- No domain events (`docs/contracts/events.md` unchanged).

### D5. Admin UI (`apps/admin/src/areas/banners/`)

- Navigation: new group "Storefront" with "Home banners" (route id `banners`, permission from `ADMIN_OPERATIONS`).
- List: thumbnail, title (UI-language text, fallback default locale), state badge (text, not colour only), dates, a "shown on the storefront" mark for the first 3 live, move up/down buttons (keyboard, announced via a live region; no drag-only control), edit, delete with a confirmation dialog.
- Form (create/edit page): image upload through the existing upload panel and queue: a DEFAULT picture slot plus one slot per content locale ("uses the default picture" until one is uploaded, with a remove button; `useBrandLogoUpload` pattern, one file per slot), aspect hint "2:1, e.g. 1280 x 640; keep the important part centred"; per-locale fieldsets for title, text, alt (`locale-text.ts`, content locales from `GET /admin/config`); link; tone; active switch; start/end `datetime-local` with the time zone shown; client validation with core `checkBannerLink` and `validateI18nText`, server errors mapped by `submit-errors.ts`; unsaved-changes guard; focus via `useFocusAfterCommit`.
- Preview: a token-styled card per locale (picture 2:1 cover, title, text, tone), labelled "approximate"; no storefront iframe.
- States: loading, empty ("No banners yet" + create), load error with retry, uploads disabled (`media.uploadsEnabled` false: form explains and blocks a new image), `403` handled, 50-cap message.
- i18n: `banners.*` in admin `uk` and `en` messages; no hardcoded strings (source guards). Tokens only.
- Knowledge base: article `home-banners` (topic `catalog` or a new `storefront` topic) with a `screen` block, steps, a note on the 3-shown limit, the 60 s delay, image size, and a warning that external links leave the shop; "Help for this page" mapping for the new routes.

### D6. Storefront

| Option | Behaviour | Verdict |
|---|---|---|
| **A. `source: "admin" \| "config"` on `BannersSection` (recommended)** | `admin`: items from `GET /store/banners`; `config`: today's typed `items` | Explicit, no surprise |
| B. Admin, fall back to config when the shop has none | | An owner who deletes every banner sees the demo ones come back; rejected |
| C. Admin only, drop config banners | | Removes a working mode forks may prefer |

- Template default: `source: "admin"`; `pnpm seed` creates the three demo banners (demo PNG/WebP images in `seeds/assets/`, uploaded through the media service like the product images, `TODO(fluxkit)` copy, idempotent by fixed ids). SVGs cannot be uploaded (media accepts JPEG/PNG/WebP), so new raster demo images are needed; `public/home/banner-*.svg` stay for the `config` mode and its spec.
- `isDataSection` includes an admin `banners` section; `loadHomeSection` gets a `banners` case; the API answer is re-checked (at most 3 used, link through the storefront check: a bad item is skipped and logged, not a page error).
- Empty list: section hidden (no heading). Outage with no last-good copy: section hidden and the error logged in full (a promo slot showing "could not load" adds nothing; other data sections keep their inline error). Recommended; listed in risks.
- Rendering: `BannersView` takes a picture that is either a `LocalImage` (config) or a remote image (`StoreImage` with `allowedImageUrl`, width/height from the API); a fixed 2:1 frame with `object-cover`, so any upload causes no layout shift; refused host -> token placeholder. Production needs the media host in `STOREFRONT_IMAGE_HOSTS` (existing rule, documented).
- Alt: `image.alt` when given, else decorative `alt=""` (also settles the PR 225 decorative-alt minor for this mode).

### D7. Migration and privacy

- `0012_banner.sql` (generated) + `0012_banner.down.sql` (hand-written: drop table, delete the `drizzle.__drizzle_migrations` row by `created_at` = journal `when`). Tested up, down, up, down on a `_test` database; `db:drift` clean.
- Down loses banner rows; their uploads stay attached (files kept).
- Privacy: `banner` in `tables-no-personal-data.ts` (D24, all columns `none`); `docs/privacy/data-inventory.md` row. Note in the inventory and help article: texts are public marketing copy, do not enter personal data.
- `CHANGELOG.md`: schema change and new routes.

### D8. Tests

- **TDD (failing first, evidence in the report)** in `packages/core/src/content/`: `bannerWindowState(now, banner)` (null bounds, `starts_at == now` live, `ends_at == now` not live, inactive wins, `ends <= starts` refused), `selectLiveBanners(rows, now, 3)` (order, ties, cap), `checkBannerLink` (case table incl. `%2e%2e`, `/uk/x`, `HTTPS://`, credentials, tab/newline, 2049 chars, `javascript:`, `//x`), text limits. Mutation check of the window boundaries.
- API integration (real Postgres): CRUD, permission matrix (viewer `403` on writes, manager ok, signed out `401`), CSRF, strict schemas, `upload_not_found`, `first_attached_at` set, job 7 keeps a banner image, FK refuses deleting an attached upload row, 50 cap under concurrency, reorder mismatch, store filtering (inactive, future, expired, 4th live hidden), locale fallback, no internal field in the store answer (schema snapshot), `openapi.json` freshness, migration up/down/up/down.
- Admin unit: form model, error mapping, list states, permissions spec, source guards (no hardcoded text/colours), help content spec.
- Storefront unit: `source` modes, data section, skipped bad item, outage hides, parity of the link case table, CLS-safe frame.
- E2E: admin suite `banners.e2e.ts` (upload, create, validation messages, reorder by keyboard, delete, viewer read-only); storefront suite (API: sign in as admin, upload, create live + future + inactive banners -> home shows only the live one with its link; delete -> section hidden); existing `design-b` and `home-banners` specs updated for the seeded data.

## 4. Delivery (small PRs, each independently reviewed)

| PR | Content | Owned paths | Needs owner approval |
|---|---|---|---|
| 0 | This plan | `docs/plans/2026-11-05-admin-home-banners.md` | Plan, open questions |
| 1 | ADR 0046; core rules (TDD); schema + `0012_banner` up/down; `markAttachedByIds`; admin + store controllers; api-client; openapi; privacy inventory; docs | `packages/core/src/content/`, `apps/api/src/banners/`, `apps/api/src/database/schema/banners.ts` (+ `index.ts`), `apps/api/drizzle/0012_*`, `apps/api/drizzle/meta/`, `apps/api/src/media/` (one method), `apps/api/src/privacy/inventory/tables-no-personal-data.ts`, `packages/api-client/`, `docs/api/banners.md`, `docs/api/openapi.json`, `docs/contracts/api.md`, `docs/privacy/data-inventory.md`, `docs/files/{core,api,api-client}.md`, `docs/adr/0046-*.md`, `CHANGELOG.md` | Migration/schema, public contract, media change, permission choice |
| 2 | Admin area, navigation group, messages, help article, admin e2e | `apps/admin/src/areas/banners/`, `apps/admin/src/routes.ts`, `layout/navigation.ts`, `router/paths.ts`, `messages/`, `areas/help/content/`, `apps/admin/e2e/tests/banners.e2e.ts`, `apps/admin/README.md`, `docs/files/admin.md` | none beyond PR 1 |
| 3 | Storefront `source`, data section, rendering; demo banners in seeds; storefront e2e | `apps/storefront/src/config/home.ts`, `components/home-sections.tsx`, `lib/home-data.ts`, `lib/home-banners.ts`, `lib/store-data.ts`, `seeds/`, `apps/api/src/seed/`, `apps/storefront/e2e/`, `apps/storefront/README.md`, `docs/files/{storefront,seeds}.md`, `seeds/README.md` | Default `source: "admin"` and demo copy |

Every PR: `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `check:docs`, `test` (real services), `pnpm --filter @fluxkit/api db:drift`, the touched e2e suites; `docs/HANDOFF.md` own lines. PRs 2 and 3 can run in parallel after PR 1 (disjoint paths).

## 5. Risks, rollback, not verified

- **Stale by up to 60 s** (Next data cache): a banner ends a minute late. Accepted like catalog pages; a tag revalidation hook does not exist.
- **Images**: uploads of any aspect ratio (fixed 2:1 frame crops); missing `STOREFRONT_IMAGE_HOSTS` entry in production shows placeholders; deleting or replacing a banner leaves its file (known media gap, no purge).
- **External links**: any `https` host is allowed (as in PR 225); a compromised `catalog.write` account can point a banner at a phishing site. Mitigation option: paths only (question 5).
- **Copy**: admin-entered offers are not covered by `STOREFRONT_REQUIRE_LEGAL_TEXT`; personal data typed into texts would be public (inventory says `none`).
- **No rate limit** on `GET /store/banners` (same gap as all catalog store routes).
- **Time zones**: admin enters local time; a shop admin in another zone than the shoppers can be confused (UI shows the zone).
- **Removability**: a fork without banners keeps a dormant table and routes (D1).
- **Rollback**: revert PR 3 (or set `source: "config"`) restores static banners; revert PR 2 removes the screen; PR 1 down migration drops the table (banner rows lost, uploads kept).
- **Not verified**: everything; this is a plan. The feasibility findings of D1 come from reading code and contracts, not from a spike.

## 6. Open questions for the owner (recommended default first)

1. Core module (recommended) or a removable feature package after building five extension points first (D1)?
2. Template default: banners from the admin with three seeded demo banners (recommended), or keep the static config as default?
3. Permission: reuse `catalog.read`/`catalog.write` (recommended), or a new `content.manage` permission?
4. Audit log entries for banner changes: none, like catalog edits (recommended), or new `banner.*` actions (migration change to the audit target kinds)?
5. Links: storefront paths and any `https` address (recommended, as today), or storefront paths only?
6. Limits: up to 50 stored, 3 shown, home page only (recommended); or a `placement` for other pages (category banners) now?

### Owner answers (2026-11-05)

1. Core module, no flag (ADR 0046). Answered by the owner.
2. Template default: banners from the admin, three demo banners created by `pnpm seed`. Answered by the owner.
3. Permission: reuse `catalog.read` / `catalog.write`. Answered by the owner.
4. No audit entries for banner changes (a recorded gap, like catalog edits). Answered by the owner.
5. Links: storefront paths and any `https` address. NOT asked: the recommended default stands, the owner may change it.
6. Limits: up to 50 stored, 3 shown, home page only. NOT asked: the recommended default stands, the owner may change it.

## 7. Amendments (owner, 2026-11-05)

- **Admin interface = "variant 2"**: list and form with a live preview. The preview renders the storefront's own banner component (extracted into `@fluxkit/ui` so the admin and the storefront draw the same card, tokens only), per locale, with light/dark and phone/desktop switches. Reorder by drag and by up/down buttons (keyboard, live region). Live checks: picture ratio 2:1 (with the real size shown), text lengths, "both languages required to activate", date window in the past. A conductor of sections (variant 3) and on-page editing (variant 4) are NOT part of this plan.
- **No custom HTML or iframes for the owner** (XSS, CSP, theming, accessibility; AGENTS section 11). The owner's freedom of design comes from the new **`image` layout** (D2): a finished picture with a description and a link. A developer who needs more adds a section in a fork's `config/home.ts`. A sanitised HTML block stays a possible later plan (needs a sanitiser dependency: red zone).
- **`image` layout rules**: `image_alt` required in the default locale (also the link's name), title and text hidden and stored null; the storefront renders one link around the picture in the fixed 2:1 frame (no overlay text, no tone); the same 3-shown limit and date window; the admin preview shows only the picture; the form warns that text inside a picture is not read by screen readers, so the same words belong in the description of each language.
- **Pictures per language (question 7, answered by the owner 2026-11-05)**: one picture per locale PLUS a default picture, in v1 (D2: table `banner_image`). The preview shows the picture of the locale being previewed; the form states which locales still use the default; migration `0012_banner` creates both tables (down drops `banner_image` first); the storefront resolves the locale picture on the server (the API already returns the right one).
- Tests added for the layout: core rules (alt required for `image`, title required for `card`), API validation, storefront rendering of both layouts (accessible name from alt for `image`), admin form switching layouts without losing the shared fields.
- Tests for the per-language pictures: locale picture chosen over the default and the default used when a locale has none (API and storefront), a locale outside the content locales refused, every picture marked attached in the save's transaction, removing a locale picture keeps the old upload (see the correction in section 8), cascade on banner delete, migration up/down/up/down with both tables.

## 8. Results

### PR 1 (API; branch `feature/banners-api`, 2026-11-05; PR 228, independently reviewed: no blocker)

Built: ADR 0046; `packages/core/src/content` (link, window, live selection, layouts, pictures, order, count); schema `banners.ts` and
migration `0012_banner` (generated) with the hand-written down script; `markAttachedByIds` in the media module; `apps/api/src/banners`
(admin and store routes); privacy inventory (`banner`, `banner_image`: D24, no personal data); api-client (`listBanners`, six
`*HomeBanner*` admin methods); `openapi.json`; docs (`docs/api/banners.md`, index, `docs/contracts/api.md`, `docs/files`, the media
and audit notes, CHANGELOG).

Verified (real commands, each exit code read):
- Core TDD: the specs of `src/content` were written first: with the modules missing, 3 files failed to load; with throwing stubs,
  98 of 98 tests failed; after the implementation 98 of 98 passed. Mutation check of the window: 8 mutants (start `<` to `<=`, end
  `>=` to `>`, the invalid-window guard, "inactive wins" removed, both year bounds, position order), each killed.
- API integration on real Postgres, Redis and Meilisearch (native, private ports): `banners.spec.ts` (34) and `store-banners.spec.ts`
  (10), the new `markAttachedByIds` block in `media-attach.spec.ts`, `migrations.spec.ts` (0012 up, down with data twice, up; the
  dependent-object refusal) and `migrate-entry.spec.ts`. Full API suite: 256 files, 4468 tests, exit 0 (the first full run found four destructive schema specs whose drop lists and catalog-name checks did not know the new tables; fixed).
- `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `check:docs`, `pnpm --filter @fluxkit/api db:drift`: 0.
  Core 2176, api-client 1399, theme 97 tests pass; the consumers too: admin 1666 (after `pnpm --filter @fluxkit/admin build`), storefront 1833. `pnpm openapi:export` followed by Prettier (the committed file is Prettier
  formatted; the export alone writes unformatted JSON, as before) leaves no diff; the freshness test compares parsed JSON.

Decisions taken inside the plan's frame (not red zone, listed for the reviewer):
- Every refused link answers the one code `invalid_link` (the core reason is in `message`); the leading-locale refusal uses the
  configured `LOCALES`, without regard to case.
- `layout: image` with a title or text in the request is `400 not_allowed_for_layout` (not silently dropped); a PATCH that switches a
  stored banner to `image` clears its title and text. Other codes: `invalid_window`, `out_of_range` (window), `locale_not_allowed`,
  `duplicate` (picture locales), `order_mismatch` (`400 validation_failed` at `ids`).
- `markAttachedByIds` checks ids whatever `MEDIA_PUBLIC_BASE_URL` and the driver are (an id is never "foreign").
- Admin list and reorder answer `{items}` without paging (at most 50). The store route refuses unknown query parameters (strict, like
  the other store routes) and returns `tone` for the `image` layout too.
- `banner_image.locale` has a CHECK on the locale-code shape of `@fluxkit/config`; which locales are allowed stays a service rule.
- The list lock key is `BANNER_LIST_LOCK_KEY = 7_302_150_002`; "now" comes from the injected `CLOCK`.

Correction to D2 and section 7: "replacing or removing a locale picture frees the old upload for job 7" does not hold: the old upload
was marked attached when it was saved, and job 7 deletes never-attached uploads only (ADR 0028). It is no longer referenced (no
foreign key holds it) but it stays, with its file: the known "no purge" media gap. Tested as such.

For PR 2: `apps/admin/src/lib/problem-messages.spec.ts` scans the admin API docs for codes; once `banners.md` joins its list, the new codes (`invalid_link`, `not_allowed_for_layout`, `invalid_window`, `order_mismatch`, `too_many_banners`, `duplicate`) need admin messages.

Not verified: the admin screen and the storefront (PRs 2 and 3); e2e suites (no UI change); the Docker `compose` and `deploy-smoke`
jobs; a real host.

## 9. Results of PR 2 (admin screen; branch `feature/banners-admin`, 2026-11-05; not reviewed yet)

Built: `apps/admin/src/areas/banners/` (list, create and edit pages, form model, preview, picture uploads, reorder, permissions),
navigation group "Storefront" with "Home banners" and three routes (`/storefront/banners`, `/new`, `/:id`; permissions from
`ADMIN_OPERATIONS`), "Help for this page" entries, lazy messages `banners.json` (uk, en), the API's banner codes in `errors.json`
and `KNOWN_REASON_CODES` (`problem-messages.spec.ts` now scans `docs/api/banners.md`), help topic "Storefront" with the article
`home-banners`, `BannerCard` in `@fluxkit/ui` (markup and classes of the storefront's `BannersView`, tokens only), admin e2e
`banners.e2e.ts`, docs (`docs/files/admin.md`, `docs/files/ui.md`, `apps/admin/README.md`, `apps/admin/e2e/README.md`, CHANGELOG,
HANDOFF). No API, schema, permission, configuration variable or dependency change; `docs/api/*` untouched.

Verified (real commands, each exit code read; services native on private ports):
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm check:boundaries`, `pnpm check:env`, `pnpm check:docs`: 0.
- Unit: admin 1813 tests in 159 files after `pnpm --filter @fluxkit/admin build` (the banner specs: 146 tests), `@fluxkit/ui` 212,
  `@fluxkit/theme` 97 (design guard and contrast scan over the new files). `@fluxkit/api-client` not touched.
- Failing first: `problem-messages.spec.ts` with `banners.md` in its list failed on the main branch's code map (7 codes missing:
  `too_many_banners`, `order_mismatch`, `not_allowed_for_layout`, `locale_not_allowed`, `invalid_characters`, `invalid_window`,
  `out_of_range`), then passed with the messages added. The 2:1 tolerance spec caught a float rounding bug in the first
  `hasBannerRatio` (1344 x 640, exactly 5 % off, was refused); fixed with whole-number arithmetic.
- Admin e2e on real Postgres 16, Redis 8 and Meilisearch 1.55: `banners.e2e.ts` 5 of 5, then `--repeat-each=4` 20 of 20; the whole
  admin suite 60 of 60.

Decisions inside the plan's frame (listed for the reviewer):
- **Core rules are copied, not imported**: the admin's source guard forbids `@fluxkit/core` in the browser bundle (it would pull zod
  and all of core; `form-rules.ts` does the same). `banner-rules.ts` repeats `checkBannerLink`, the limits and the window bounds;
  `banner-rules.spec.ts` runs every case of core's own table (and its edge cases) through both and compares. `validateI18nText` is
  not copied whole: the form checks required, default locale and the code-point length; the server's other codes are mapped.
- The list shows the API's `state` and `shownOnStorefront` (computed with the server's clock); core's `bannerWindowState` is not
  needed in the browser.
- "Both languages required to activate" (section 7) is a block before sending: switched on, a `card` needs its title and an `image`
  its description in EVERY content locale (the API itself requires only the default locale).
- The form is `noValidate` (like the Shipping forms): its own summary and field messages, translated, also for the picture slots.
- One upload queue for all picture slots (one file at a time; a selection made while one uploads is ignored, so the slot cannot
  switch under a running upload).
- Reorder: one request per move or drop, the buttons stay focusable (`aria-disabled`) while it runs, the focus returns to the
  button (its twin when the row reached an end), a polite status line announces "moved to position N of M". Dragging is a pointer
  enhancement only.
- `BannerCard` puts every picture in a fixed 2:1 frame (`aspect-2/1`, `object-cover`), as D6 asks for admin banners; the config
  mode's pictures are 2:1 today.
- The preview's desktop width is a fixed three-column row (the card at one third, as with three banners) that scrolls sideways in a
  narrow column (a focusable region); phone width is 20 rem.
- Navigation: the Storefront group sits between Catalog and Sales; the help topic between Catalog and Prices (the "previous" link of
  the `prices` article changed, its spec was updated).

Not verified: the storefront rendering of admin banners (PR 3); a screen reader (roles and names are checked by the specs and e2e);
other browsers than Chromium; the Docker `compose` and `deploy-smoke` jobs; the article texts by the owner.

### Review fixes of PR 230

- **Link rule** (PR 229 tightened core `checkBannerLink`: dot-like characters in a host, a numeric last label unless a dotted
  IPv4, malformed IPv6 literals): the admin copy follows. Failing first: the 10 refused and 7 accepted rows plus 4 extra host
  rows, run against core built from PR 229's sources (not committed here), failed 25 tests (24 rows, the count guard) before the
  port and passed after. Until PR 229 is merged, the parity rows of this branch disagree with this branch's own core (merge
  order: PR 229 first).
- **M1 time zones**: `localInputToIso` now has one rule for every zone: the offsets a day before, at and a day after the wall
  clock are the candidates; two readings (clocks go back) take the EARLIER instant; none (clocks go forward) uses the offset
  before the change, moving the time forward by the jump. The result names the case (`note: "gap" | "ambiguous"`), and the
  date field says what is saved. Failing first: the cases for Kyiv, New York, Lord Howe (30 minutes), UTC and Etc/GMT-14 failed
  (9 tests); the old algorithm moved New York's gap backward (02:30 -> 01:30 EST) and took the later Kyiv reading. The year
  bounds message says the year is counted in UTC.
- **m3** the "every language before switching on" block applies only when this save switches the banner on, changes the
  layout or changes that language's naming text; an already-active banner with a language missing gets a warning.
- **m4** refusals at `title`, `text`, `imageAlt` mark the default-locale field; `layout` and `tone` errors show at their
  controls. **m5** the picture limits text says a replaced or removed picture stays in the media storage. **m6** "Use the main
  picture" is offered with uploads off. **m7** no `maxLength` on the link (the rule reports `too_long`).
- Failing first for m3, m4, m6, m7 and the time hints: the 6 new tests failed against the previous sources and pass now.
- E2E: a new scenario checks that the list shows every stored banner (the seed's demo banners included), no empty state, and
  "Shown on the storefront" on exactly the banners the API marks (at most 3).

- **Storefront on the shared card** (review M2, separate commit after merging PR 229): `BannersView` renders every item, both
  sources and both layouts, through `BannerCard`; `home-sections.tsx` passes the picture (`LocalPicture` or `StoreImage` with
  `fill`) and the link (`next/link` or an anchor). `BannerCard` took the storefront's exact classes first (image layout: no
  background, hover border). A source guard in `home-sections.spec.tsx` failed on the merged main and passes now; every storefront
  unit test of PR 229 passes unchanged.
- **Second review** (no blocker, no major): the form's link check asks the browser's URL parser after core's rule, like
  the storefront (`https://xn--/`, full-width `＠`, `：` or digits, a joiner in the host are refused before saving; core is
  unchanged, its parity is checked on `checkCoreBannerLink`); the doubled-hour hint names the offset of the reading used; the
  required mark follows the blocking rule (`activationRequires`), so a language that is only warned about is not marked;
  `BannerCard` pins that an empty text is no text. Failing first: the 6 link rows, the hint text and the required mark.

## 10. Results: PR 3 (storefront and seed; branch `feature/banners-storefront`, 2026-11-05; not reviewed yet)

(Section 9 is left to PR 2, built in parallel.)

Built:
- Storefront: `BannersSection` is `AdminBannersSection | ConfigBannersSection` (`source` required, typed; compile-time checks in
  `config/home.spec.ts`); template default `source: "admin"`; the PR 225 cards stay as `demoConfigBanners` for `source: "config"`.
  `StoreData.listBanners` (tag `store:banners`, 60 s cache, last-good copy), a `banners` case in `lib/home-data.ts`, the checks of an API
  banner in `lib/home-banners.ts` (`checkStoreBanner`, `storeBannerViews`), one renderer for both sources and both layouts in
  `components/home-sections.tsx` (2:1 `object-cover` frame, `StoreImage` with a new `fill` mode for uploads, `LocalPicture` for config).
- The storefront link check (`checkBannerHref`) restates core `checkBannerLink`: the two PR 225 minors are fixed (`%2e` dot segments, a
  leading locale segment); `lib/home-banners-parity.spec.ts` runs core's case table (copied row for row, 13 accepted, 47 refused, 17 more).
  `localizedHref` (navigation and hero links, developer config) is unchanged.
- Seed: `seeds/src/banners.ts` (two `card`, one `image` banner with an own `en` picture; `TODO(fluxkit)` copy), four WebP pictures from
  `scripts/generate-demo-images.mjs` (`--only` added; 35 KB), the runner's `ensureBanner` (through `BannersService`; fixed id, see below).
- Docs: storefront README "Home banners", e2e README, `docs/files/{storefront,seeds,api}.md`, `seeds/README.md`, root README "Try it
  locally", CHANGELOG, HANDOFF line.

Verified (real commands, each exit code read): see the PR report (lint, format:check, typecheck, check:boundaries, check:env, check:docs,
theme 97, storefront unit 1958, seeds 20, core 2176, API seed/banners/media/newest-order specs on real Postgres, Redis and Meilisearch,
full storefront e2e 152 passed and 4 skipped (`search-off`, by design)). The e2e test "a banner created through the admin API" waited
46 s in one run and 60 s in another: the 60 s data cache is real and bounded; the test reloads, it has no test-only cache switch.
Screenshots before/after (uk, en, light, dark, 390, 1280), under `next dev` with the development `/media` rule: the `en` page shows the
English picture of the picture banner, `uk` the default (Ukrainian) one.

Decisions taken outside the letter of the plan or the task (for the reviewer):
- A picture whose host `allowedImageUrl` refuses shows the token PLACEHOLDER (plan D6, the product image rule) and is logged; it is not
  skipped. Reason: the host is a deployment setting shared by all banners (skipping would hide the whole section on one missing
  `STOREFRONT_IMAGE_HOSTS` entry), and the e2e stack serves media over plain `http`, so skipping would make the banners untestable there.
  A banner whose link or shape fails is skipped and logged as asked.
- The admin's banners are awaited by the page, not streamed (no `Suspense` boundary of their own): no skeleton can match an unknown
  number and layout, and a row arriving late near the top would shift the page. The layout above already waits for the API.
- An outage hides the section (D6): the loader logs it like every data section (`Home section "home-banners" could not be loaded.`).
- The seed creates a banner INACTIVE through `BannersService.create`, sets the fixed id with one `UPDATE banner SET id` (the only write
  outside an admin service; the service generates ids and `apps/api/src/banners` was not in this PR's paths), then adds the locale
  picture and activates it through `BannersService.update`. A cleaner later option: an optional id on the service's create, for the seed only.
- `apps/api/src/test/seed-rows.ts` (outside the owned paths, test support of the seed) removes the demo banners and their uploads, so the
  specs that run the seed (`seed.spec.ts`, `newest-order.spec.ts`) leave the shared test database clean.
- The admin e2e (`apps/admin/e2e/prepare-database.ts` runs `pnpm seed`) now starts with three demo banners: PR 2's admin banner e2e must
  expect them (not changed here).
- The storefront kept its own rendering in PR 3; PR 2 (after merging it) switched `BannersView` to the shared `BannerCard` of
  `@fluxkit/ui` (section 7), so the storefront and the admin preview draw one card.

Not verified: the Docker `compose`/`deploy-smoke` jobs; a production build with a real https media host (only the placeholder path and
`next dev` were seen); the full API suite (only the specs above); the admin screen (PR 2).

### Review fixes of PR 229 (independent review)

- M1: core `checkBannerLink` accepted hosts the WHATWG parser (and so the storefront) refuses: dot-like characters (`․` U+2024,
  `。`, `．`, `｡`), a last label of digits that is not a valid dotted IPv4 (`1.2.3.4.5`, `999.1.1.1`, `shop.123`) and malformed IPv6
  literals (`[1::2::3]`, more than 8 groups, a 5-digit group, a bad embedded IPv4). Core now refuses them (`not_path_or_https`); 10
  refused and 7 accepted rows were added to core's table and to the storefront's parity copy. TDD: with the rows added and the code
  unchanged, `banner-link.spec.ts` failed 10 of 76; after the fix 110 of 110 content specs pass; the storefront parity spec passes with
  no storefront code change (its URL parser already refused them). The admin form's copy of the rule (PR 2,
  `apps/admin/src/areas/banners/banner-rules.ts`) must get the same change.
- M2: a skipped banner and a placeholder picture are logged once per server process and reason (a set of at most 200 keys, cleared
  when full), not on every render. With the dedupe disabled the two new specs fail; with it they pass.
- m2: `apps/storefront/next-env.d.ts` restored (a drive-by of `next dev`). m3: HANDOFF "Last updated". m5: the `seeds/README.md` table
  rows render as one table again.
