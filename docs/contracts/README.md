# Public contracts

Everything listed here is covered by SemVer. Anything not listed is internal.

Existing:
- `api.md` - public HTTP API (source of truth: `docs/api/openapi.json`).
- `branding.md` - the storefront brand config `apps/storefront/src/config/brand.ts` (fork-owned): logo, icons, theme colour, default social picture.
- `card-registry.md` - storefront product card registry (fork-owned `cards/custom.ts`, `ProductCardModel`) and the `view` URL parameter (draft).
- `config.md` - environment variables and the feature package contract.
- "Feature extension points" below (ADR 0049) - the API kit, feature migrations, a feature's personal-data inventory, `features` on the config routes, the storefront slice of a feature, the admin feature slices (manifest, registry, gating).
- `header-footer.md` - storefront header and footer composition: the fork-owned `config/header.ts` and `config/footer.ts` (blocks, order, controls, category count, link groups with headings, text lines) (draft; the plan `docs/plans/2026-11-08-design-changeability.md` calls it `layout-config.md`).
- `home-sections.md` - storefront home sections: the per-section `width` and the `custom` kind with the fork-owned `config/custom-sections.ts` (draft).
- `events.md` - domain events (the outbox), the handler metadata key, the delivery rules and the order ports.
- `email-templates.md` - mail templates: the template contract, the registration metadata, the override rule and the built-in keys.
- `personal-data-export.md` - the personal data export document `fluxkit.personal-data-export/v1` (builder only; no route yet).
- `markdown.md` - safe Markdown (blog plan E9, ADR 0050): the "Fluxkit Markdown" syntax, `parseMarkdown`, the `MarkdownDocument` AST, its error codes and limits, and the `MarkdownView` component of `@fluxkit/ui`.
- `search.md` - catalog search: routes, facet keys, sort names, limits, the public data rule and what is not contract.
- `slots.md` - storefront UI slots: the four server-only slots (`header.top`, `product-card.badges`, `product-card.actions`, `footer.columns`), their view-model props and the fork-owned `config/slots.tsx` (draft).
- `theme-tokens.md` - design tokens.

Not written yet (add when the first implementation exists): price adjusters (a hook, with the pricing pipeline plan),
`db-extension.md` (tables safe to extend).

Entry format: name, since-version, description, shape, status (stable / deprecated since X).

## Feature extension points (stable, ADR 0049)

E1 to E4 of `docs/plans/2026-11-13-blog.md`, the storefront slice (E5 to E7) and the admin slice (E8), all below; the safe Markdown (E9)
is `markdown.md`. Kept in this file until the planned `features.md` exists (a documentation-file hook blocked creating it in PR 1). The package
contract itself (manifest, `featureModule`, `FEATURES_ENABLED`) is in `config.md`, "Feature package contract".

**API kit (`@fluxkit/api-kit`).** A feature imports these from the package's public entry, never from `apps/api` (module boundary) and
never from `@fluxkit/api-kit/internal` (API only, not a contract):

| Export | Shape and rule |
|---|---|
| `ProblemException` | `new ProblemException({code, detail, errors?, extensions?, status?, headers?, members?})`; the API's problem filter answers `application/problem+json` with `code`, `errors[]` and the extension members, as for core. Types `ProblemCode`, `ProblemInit`, `FieldError` (`{path, code, message?}`), `ProblemExtensions` |
| `RequirePermission(permission)` | Route or controller decorator; `permission` is an `AdminPermission` of core (`api.md`, route to permission) |
| `AdminController(resource, defaults?)` | `@Controller("admin/<resource>")` plus the default permission by HTTP method: `defaults.read` for GET and HEAD, `defaults.write` otherwise (`DefaultPermissions`; the catalog pair when omitted). The API guards every route under `/admin` (default deny): `401` signed out, `403` without a declared permission or with one the role lacks; the admin CSRF header on writes |
| `FEATURE_DATABASE` | `@Inject(FEATURE_DATABASE) db: NodePgDatabase` (`drizzle-orm/node-postgres`): the API's own Drizzle instance and pool. Query your own tables only; `db.transaction(...)` gives an ordinary transaction |
| `MEDIA_PORT` | `@Inject(MEDIA_PORT) media: MediaPort` (`MediaPort` of `@fluxkit/core`). `markAttachedByIds(tx, [{path, id}])` inside your save's transaction: every id must name an upload, else `400 validation_failed` with `upload_not_found` at `path` (call it before inserting a row whose foreign key names the upload). `describeUploads(ids)` -> `[{id, url, width, height}]` in the order of `ids`, unknown ids left out. Never read `media_upload` yourself |
| `LOCALE_CONFIG` | `@Inject(LOCALE_CONFIG) locale: LocaleConfig` (`{defaultLocale, locales}`), for core `validateI18nText` and friends |

**Feature migrations.**
- A feature with tables ships in its package folder: `drizzle.config.ts` (its own schema; `out: process.env.DRIZZLE_KIT_OUT ?? "./drizzle"`),
  the schema in `src/schema.ts`, and `drizzle/` with its own `meta/_journal.json`, the generated `NNNN_name.sql` and a hand-written
  `NNNN_name.down.sql` per migration, which also runs `DELETE FROM "drizzle"."__drizzle_migrations_feature_<name>" WHERE "created_at" =
  <when of its journal entry>`.
- Migrations table: `drizzle.__drizzle_migrations_feature_<name>`, a `-` of the feature name written as `_`; feature names have at most
  32 characters (`config.md`, `FEATURES_ENABLED`), so the table name fits Postgres's 63-byte identifiers.
- `pnpm db:migrate` applies the core journal, then the journals of the features in `FEATURES_ENABLED` (in that order), under one advisory
  lock. It refuses, changing nothing, when an enabled feature has no package or a table records a migration newer than its journal. A
  disabled feature is never migrated. Each journal runs in its own transaction, core first: a failing feature migration leaves the core
  (and the features before it) migrated and rolls back only its own journal; a re-run after the fix applies what is pending.
- The API refuses to start while an enabled feature has unapplied migrations, or a migration newer than its journal (an older build
  against a newer feature schema); the message names the feature and the tags or the newest recorded entry. Enabling a
  feature with tables: set `FEATURES_ENABLED`, run `pnpm db:migrate` (or the deployment's migrate step), then start the API.
- Foreign keys to core tables: declare the column as a plain `uuid` (no `.references()`: core tables are not importable) and add the
  constraint by hand at the end of the generated SQL: `ALTER TABLE "<table>" ADD CONSTRAINT "<table>_<column>_fkey" FOREIGN KEY
  ("<column>") REFERENCES "public"."<core table>"("id") ON DELETE RESTRICT;`. The drift check cannot see it; the feature's spec asserts it
  in `pg_constraint` after up and its absence after down.
- Down order: a feature's down scripts run before any core down (newest first); core never references a feature table. No down command:
  `psql "$DATABASE_URL" -f <file>`.
- `pnpm --filter @fluxkit/api db:drift` checks every feature folder with a `drizzle.config.ts`. Declare `drizzle-orm` (and `drizzle-kit`
  for development) at the versions `apps/api` pins.

**Personal data.** A feature with tables exports `personalDataInventory: PersonalDataInventory` (core `privacy`) from `src/index.ts`
(table -> column -> `{class, ref, export, erasure, reason?}`, the rules of `checkPersonalDataInventory`, ADR 0033) and checks every
column of its Drizzle tables with `checkPersonalDataInventory` in its own spec; its README repeats the rows. The API merges it with the core
inventory at startup and refuses to start when it is not an inventory, breaks a rule, lists a table without columns, classifies a table core
or another feature already classifies, or is missing or empty while the feature ships migrations. Core also checks completeness:
`apps/api/src/privacy/inventory/database-inventory.spec.ts` migrates the core and every feature package on disk into a scratch database and
fails when any column of `public` is not classified by the merged inventory. Table builders (`drizzle-orm/pg-core`, `pgTable(`) are allowed only in
`packages/features/<name>/src/schema.ts` of a package whose `src/index.ts` exports `personalDataInventory`; never in a provider.

**Enabled features on the config routes.** `features: string[]` on `GET /store/config` and `GET /admin/config`: the names in
`FEATURES_ENABLED` that loaded, sorted. A client shows a feature's pages, links and screens only when its name is listed; otherwise the
feature's routes answer `404`.

**Storefront slice (E5 to E7, blog plan PR 4a; draft until the first real slice, the blog, ships in PR 4b).** A feature's storefront part is
the route group `apps/storefront/src/app/[locale]/(feature-<name>)/`, deleted with the feature:

| Part | Shape and rule |
|---|---|
| Folder | `(feature-<name>)`, `<name>` the `FEATURES_ENABLED` name. Holds exactly `layout.tsx` at its root (only `export { default } from "../(site)/layout";`), `page.tsx` files and private `_`-prefixed folders (`_feature/`). FORBIDDEN outside the private folders, because nothing would gate them: any other file, so route handlers (`route.ts`), metadata files (`opengraph-image`, `twitter-image`, `icon`, `sitemap`, `robots`, `manifest`), `loading`, `error`, `not-found` (the app's own `[locale]/not-found.tsx` renders), `template`, `default`, nested layouts, `page.ts`/`.js`; parallel (`@slot`) and intercepting (`(.)`) folders. No `loading.tsx` above it either: every page answers a real 404 (`route-structure.spec.ts`, which lists every slice page in `mustAnswerRealNotFound`). |
| Pages | Exports only `export default async function` and, if needed, `export async function generateMetadata` / `generateViewport`, each with `await requireFeature("<name>");` (`src/features/runtime.server.ts`) as its FIRST statement: a 404 while `GET /store/config` `features` does not list the feature, before any read of the feature's API; route segment config (`dynamic`, `dynamicParams`, `revalidate`, `fetchCache`, `runtime`, `preferredRegion`, `maxDuration`) as plain literals; types. FORBIDDEN: `generateStaticParams` (it runs at build time, ungated), any other exported value, `export { ... }`, `export ... from`, `export * from`, `export default <expression>` (checked with the TypeScript compiler, `slice-rules.ts`). The first path segment is static, belongs to one slice only (the generator refuses two) and is not a shop page slug, a reserved slug (`lib/shop-pages.ts` `RESERVED_SLUGS`) or a segment of another route. |
| Enabled state | `GET /store/config` `features`, through the data cache: a switch shows within 60 s (`CATALOG_REVALIDATE_SECONDS`). While the API cannot be read and only the in-memory copy of the config is left (stale), a page and the sitemap refuse to decide (the error view, a failed sitemap); the header and footer use the stale copy (a link's page decides again), and with no copy at all show no feature link. |
| Manifest `_feature/feature.ts` | `export const feature: StorefrontFeature` (`src/features/types.ts`): `name` (equal to the folder's), `navigation: {placement: "header" \| "footer", labelKey, path}[]` (`/<segment>...` without the locale, query, fragment, whitespace, control characters or dot segments, whose first segment is one of the slice's own page segments; a label among its own messages), `sitemap(context) => Promise<{path, lastModified?, locales?}[]>` (`context`: `{locale, data}`; `locales`: the storefront locales the page exists in, absent for every locale), `messages: {uk, en}`. It imports only types, storefront constants and its message files (it is loaded on every page). |
| Messages `_feature/messages/<locale>.json` | Flat keys under `features.<name>.` only, non-empty, the same keys in every locale, equal to the manifest's `messages`. Merged after the area files and before a fork's `messages-extra` and `messages-overrides` (a fork overrides them like any upstream text; a key outside the namespace or already present fails the build and every page). The release check of `next.config.ts` reads the same files. Server only (not sent to the browser). |
| Registry | `scripts/generate-feature-registry.mjs` writes the git-ignored `src/features/registry.generated.ts` (each slice's folder name, its pages' first path segments and its manifest; written to a temporary file and renamed) from the slices on disk (empty without one) before `dev`, `build`, `typecheck` and `test` of the storefront (so also in the Docker build and after a slice is deleted). `src/features/registry.ts` checks it at load. No other module imports a slice; slices never import each other (dependency-cruiser). |
| Data | `featureData(name).read(operation, call, read?)` (`runtime.server.ts`, `StoreData.featureRead`): the slice's own request (`call({baseUrl, fetch, options})` answers a `StoreResult`) with the catalog reads' timeout, data cache (tag `feature:<name>`, 60 s unless `read.revalidateSeconds`), logging and `StoreUnavailableError`, but never the in-memory last-good copy: an outage shows the error view instead of content the shop may have taken back. |
| Header and footer | The enabled features' links are appended (`docs/contracts/header-footer.md`, "Feature links"); none, and the markup is unchanged. |
| Sitemap | `/sitemap.xml` asks each enabled feature's `sitemap` and lists the pages after the shop pages, in every locale (a page with `locales`: in those, with alternates and `x-default` among them; `x-default` is the default locale when listed, else the first; a locale the storefront does not have fails the sitemap); every path follows the link rule above (its own pages only); a failed read fails the sitemap. Without any slice on disk the config is not read for it. |

**Admin feature slices (E8).** A feature's admin screens are one folder `apps/admin/src/features/<name>/` (`<name>` = the feature name in
`FEATURES_ENABLED`), found by `apps/admin/src/features/registry.ts` (`import.meta.glob("./*/feature.ts")`); no other admin code imports it
and slices never import each other (dependency-cruiser). Deleting the folder removes the screens, the entry and the messages.

| Part | Shape and rule |
|---|---|
| `feature.ts` | exports `feature: AdminFeatureManifest` (`apps/admin/src/features/manifest.ts`): `{name, routes, navigation, messages}`; imports nothing of the slice but small constants (it is in the entry chunk) |
| `routes[]` | `{id, path, permission, titleKey, load}`: `id` is `feature.<name>.<screen>`; `path` starts with `/features/<name>` (relative to `/admin-ui`); `permission` an admin permission or `authenticated` (never `public`); `load: () => import(...)` resolving to `{Component, messageFiles}` (`messageFiles`: `feature:<name>` and any core lazy file the screen reuses) |
| `navigation` | `{group, labelKey, routeId}`: `group` one of `catalog`, `storefront`, `sales`, `settings`, `help`; the entry is appended to that group and names one of the slice's routes |
| `messages` | `{uk, en}`, each `() => import("./messages/<locale>.json")` resolving to the messages; every key starts with `features.<name>.` and every value is a non-empty string; a fork overrides them in `apps/admin/src/messages-overrides/` |
| Gating | a slice's route and entry show only when `<name>` is in `GET /admin/config` `features` and the role has the route's permission; otherwise its address is "Page not found". Known limit: opening a slice's address (a deep link or a typed URL) while its feature is off still downloads that slice's screens chunk, because the router resolves a route's `lazy` module before the shell, which reads the config, renders; holding the route on that read would hold the first render of every page. Nothing of the feature is called or shown, and its messages are not loaded (they load only for an enabled feature) |
| Requests | `adminFeatureTransport` (`apps/admin/src/lib/api.ts`) with the slice's own `TransportOperation`s (`createTransport` of `@fluxkit/api-client`); never an addition to `@fluxkit/api-client`'s operation tables |

The rules are checked in development and by `apps/admin/src/features/registry.spec.ts` over every slice of the build; a production
build leaves the checks out. Details and the slice's reuse of admin code: `apps/admin/README.md`, "Feature slices".

## Admin text overrides (draft, PR-I2b)

`apps/admin/src/messages-overrides/uk.json` and `apps/admin/src/messages-overrides/en.json` are fork-owned (upstream ships `{}` and never
edits them): flat key -> text, applied last over the admin's message files, eager and lazy (`apps/admin/src/messages/overrides.ts`), as the
storefront's `src/messages-overrides`. A key no message file has, or a value that is not a non-empty string, fails `vite build`, `vite dev`
and `pnpm --filter @fluxkit/admin test`. Contract: the files' location and shape; the message keys themselves are not contract (a renamed
key fails the fork's build, naming it). The admin's name is `app.name` and `app.documentTitle` there (`apps/admin/README.md`).

## Contract files in the template and in a client fork

`check:docs` (`scripts/check-docs.mjs`, CI job `docs`) fails a PR that changes a storefront contract file without a change under
`docs/contracts/`: `apps/storefront/src/config/{brand,catalog,header,footer,slots,custom-sections,home}.ts(x)`,
`apps/storefront/src/components/cards/{custom,types}.ts(x)` and `apps/storefront/src/lib/{custom-sections,slots}.ts(x)`. The rule is
for the template, where such a change may change a contract.

A client fork fills the config files among them itself (`docs/customization.md`), which changes no contract. It marks itself with
an empty file `.fluxkit-fork` at the repository root (checked in, no environment variable), in a commit or PR of its own. The check reads
the marker from the PR's BASE ref, so no PR relaxes its own check; a tree with both the marker and the upstream-only spec below fails.
With the marker in the base, the config files
(`config/*.ts(x)` above and `components/cards/custom.ts`) are left out of the rule; the files that define the contract
(`components/cards/types.ts`, `lib/custom-sections.ts`, `lib/slots.ts`) keep it. The template never contains the marker:
`apps/storefront/src/fork-marker.upstream.spec.ts` (upstream-only, deleted by the fork in the same step) fails if it does.
