# Plan: admin knowledge base ("Help")

Status: built on branch `feature/admin-knowledge-base` (pushed, no PR); awaiting review. Owner request 2026-11-02: "the admin should have a knowledge base: how to do things". Scope decided by the orchestrator: admin app only; no API, DB, migration or new dependency (red zones: none).

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

- Built as planned: decisions 1 to 6. 17 articles in 5 topics (`first-steps`, `glossary`, `product-types`, `create-product`, `images`, `categories-brands`, `publishing`, `search`, `prices`, `stock`, `orders`, `customers`, `payments`, `shipping`, `email`, `personal-data`, `users-roles`, `audit-log`); the block set gained `heading` (sections need anchors), and "Open this screen" takes its text from the route title (no extra text to translate).
- Initial JavaScript: 426 392 -> 430 980 bytes raw, 127 791 -> 128 950 gzip (budget 440 000 / 135 000). Help chunk 110.6 KB raw, 33.8 KB gzip (both languages; lazy).
- `localStorage`: still one accessor (`browserStorage`); the source guard now names its three users (language at start, language switch, checklist).
- The help area asks the shell (`router/screen-access.tsx`) for a screen's title and permission instead of importing the route table, which `check:boundaries` refused as an import cycle.
- Verification (2026-11-02): `pnpm lint`, `typecheck`, `format:check`, `check:boundaries`, `check:env`, `check:docs` exit 0; admin unit tests 1661 passed; admin e2e suite 55 passed on throwaway native Postgres 16, Redis and Meilisearch. An earlier full run had one failure in `product.e2e.ts` ("The product is published." not shown after Publish, run under load, 14.7 s); not reproduced in 4 repeats nor in the final full run; the admin README lists a lost click while the product reloads as a known limit.
- Mutation check: focusing the section directly in the article's effect (instead of `useFocusAfterCommit`) fails the e2e "Help for this page" scenario once the help chunk is already loaded (the route focus wins); restored.

### Claims in the articles NOT verified in a browser or against a live service (read from code and docs only)

- Storefront side: the compare-at price is shown "as the price before the discount" (component `product-purchase.tsx` uses it; the exact look not checked); an inactive category hides its subcategories in the storefront (from the admin hint text); the "Privacy and data" and "Forgot your password?" labels (from the storefront messages).
- Timings depending on configuration: "within a minute or two" for search sync (scheduler interval 60 s by default and job 13), reservation = payment time (30 min default) + 10 min, low-stock threshold 5 by default, audit events purged after 365 days only when a retention period is set.
- Providers: Monobank, Resend and Nova Post were only run against stubs (HANDOFF); the articles say so. Nova Post limits (pickup points only, no cash on delivery, one parcel) are taken from the plugin README.
- A late payment gets a full refund queued automatically (from `docs/api/payments.md`, attention `late_payment`).
- The shipment mail carries the tracking number (template `shipment.created`), the order mails are sent when email is set up and the scheduler relays events.
- Legal: the personal-data article repeats `docs/privacy/README.md` and carries its "not legal advice" caveat; no legal outcome is promised.

### Open questions

- Should the checklist's payment step distinguish the test provider? It needs the provider codes in `GET /admin/config` (API change, red zone; not done).
- Should the content be split per language to shrink the help chunk (about half of 110 KB)? Not needed for the entry budget; left as is.
