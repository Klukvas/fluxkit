# Plan: admin knowledge base ("Help")

Status: in progress (branch `feature/admin-knowledge-base`). Owner request 2026-11-02: "the admin should have a knowledge base: how to do things". Scope decided by the orchestrator: admin app only; no API, DB, migration or new dependency (red zones: none).

## Goal

A shop manager finds, inside the admin, short and honest instructions for every main task, in Ukrainian (default) and English, with links to the real screens. A client fork replaces or extends the articles by editing one folder, without touching the screens.

## What exists (checked before building)

- No help, docs or onboarding screen in the admin; the start page (`src/areas/home/home-page.tsx`) shows one sentence.
- Route table `src/routes.ts` (paths in `src/router/paths.ts`, permission from an API operation; `getMe` = any signed-in admin), navigation as configuration (`src/layout/navigation.ts`), lazy areas with lazy message files (`src/messages/index.ts`), focus after navigation (`src/router/route-focus.tsx`), `useFocusAfterCommit`, UI library `@fluxkit/ui` (tokens only).
- Data for a setup checklist without new endpoints: `GET /admin/config` (any signed-in admin: `onlinePayment`, `emailDelivery`), `listProductTypes`, `listCategories`, `listProducts` (`status=active`), `getProductInventory`, `listShippingMethods` (`isActive`), `getEmailStatus` (`providerCode`). The storefront's legal placeholders are a build-time setting the admin cannot read.

## Decisions

1. **Content is typed data**, `apps/admin/src/areas/help/content/`, one file per topic (`start`, `catalog`, `prices-stock`, `sales`, `settings`) plus `index.ts` (topics and order) and a `README.md` for client forks. An article is `{id, topic, title, summary, keywords, blocks}`; every text is `Record<Locale, string>` (uk and en), so a missing language is a type error. Blocks are a closed set: `heading` (a section with an anchor id), `paragraph`, `steps`, `note`, `warning`, `screen` (link to a real admin screen, by route id), `definitions`. No markdown, no HTML, no `dangerouslySetInnerHTML`: React renders each block; a spec refuses HTML-like text.
2. **Routes** `/help` (topics, search, the getting-started checklist) and `/help/:articleId` (the article; sections addressable as `#<section>`), guarded by `getMe` (every signed-in role). A navigation group "Help" at the end. A "link to screen" is shown as a link only when the admin's role may open that screen; otherwise a line says the role cannot open it.
3. **Search** is client-side over title, summary, keywords and body of both languages (results shown in the UI language), case- and diacritic-insensitive (NFD, marks removed, apostrophe forms dropped), every word must match; ranking title > keywords > summary > body, then article order. The query is kept in `?q=`. A polite live region announces the number of results.
4. **Contextual help** is one "Help for this page" link the shell renders at the top of `main`, from a map route id (and the product editor's `?tab=`) to article and section (`src/layout/context-help.ts`). One place instead of edits in fourteen area pages; a spec checks every target exists.
5. **Getting-started checklist** (help area, lazily loaded by the start page so the entry chunk stays small): nine ordered steps, each linking the article and the screen. Computed from existing reads where possible; a step whose read the role may not run says so; the legal texts step is a manual checkbox. Stored in `localStorage` per admin user id (key with the opaque id only, values are step ids and a dismissed flag; nothing personal) through the existing storage accessor of `i18n-context.tsx`. Dismissible on the start page; always shown under Help with "Show on the start page again". This relaxes the admin plan's "only the UI language in localStorage" rule (`docs/plans/2026-10-19-admin-ui.md`, Security); the guards are updated to name exactly these two uses.
6. **Articles describe what the code does today** (read from the code and `docs/api/*.md`, `docs/privacy/README.md`, ADR 0004/0006/0008), say what the shop does not do (returns, two-factor, editing mail templates, address delivery by Nova Post), mark configuration-dependent claims and test-only providers, and promise no legal outcome.

## Files

- New: `apps/admin/src/areas/help/` (index, pages, model, search, checklist model/storage/card, `content/*`), `src/messages/{uk,en}/help.json`, `src/layout/context-help.ts`, specs next to them, `apps/admin/e2e/tests/help.e2e.ts`.
- Changed: `src/router/paths.ts`, `src/routes.ts`, `src/layout/navigation.ts`, `src/layout/shell.tsx`, `src/areas/home/home-page.tsx`, `src/messages/index.ts`, eager `navigation.json`/`shell.json`, existing specs that list areas (messages, routes, navigation, build output, source guards).
- Docs: `docs/files/admin.md`, `apps/admin/README.md`, `CHANGELOG.md`, `docs/HANDOFF.md`, this plan (results).

## Risks

- Articles drift from behaviour: routes and anchors are tested; the prose is not. Unverified claims are listed in "Results".
- Entry budget (`build-output.spec.ts`, 440 000 raw): only route rows, paths, titles and the context map are eager; measured below.
- The checklist reads up to 9 requests on the start page; each read is bounded (`limit` 1 to 100, at most 5 inventory reads).

## Verification

`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, admin unit tests (`pnpm --filter @fluxkit/admin test` after a build), the admin e2e suite on throwaway native Postgres, Redis and Meilisearch; screenshots uk/en, 1280 and 390 wide.

## Results

(filled in at the end of the work)
