# Plan: storefront shop pages, contacts, footer and demo copy (repair batch 2)

Status: implemented on `feature/storefront-shop-pages` (from `origin/main` `3760110`), PR 232, independently reviewed (no blocker; minors fixed, see "Review fixes"; M1 is an owner decision), see "Results".
Source: the owner's UX review of 2026-11-06 (simulated shopper Iryna: no contacts, no delivery and payment page, no return policy,
no FAQ, no About, no size guide, placeholders and `TODO` text visible, minimal footer). Storefront and seed data only: no API, schema,
dependency, environment variable or theme-token change. `apps/admin/**`, `packages/ui/**` and the product card availability belong to
another agent in parallel and are not touched.

## Goal

1. Typed, configurable shop pages `delivery-and-payment`, `returns`, `faq`, `about`, `size-guide`, `contacts`, rendered by one route.
2. Typed shop contacts used by the footer, the contacts page and the trust bar's "Easy to contact us" tile (a link to the contacts page).
3. A richer but small footer: the shop pages and the contacts, inside the first-HTML size budget.
4. A short "Delivery and returns" note under the product page's buy box.
5. No shopper-visible `TODO(fluxkit)`, source path or bracketed placeholder in the default demo; the release check
   (`STOREFRONT_REQUIRE_LEGAL_TEXT=true`) also refuses while the new pages, the contacts, the home texts or the trust bar are demo copy.

## What exists (reused, not reinvented)

- Legal pages: `src/config/legal.ts` (`legalPages`: slug + title key, footer order; `LEGAL_PLACEHOLDER_MARKER`), `legal-identity.json`
  (read by the app AND by `next.config.ts`, which runs in plain Node and cannot import app source), `lib/legal-route.tsx` (metadata and
  page factories), `components/legal-page.tsx` (server component, `Container`, one `h1`, `textStyles`), `lib/page-metadata.ts`
  `legalMetadata` (title + canonical/hreflang through `languageAlternates`), the footer links from `layout/navigation.ts` `footerLinks`.
- Release check: `next.config.ts` `assertNoLegalPlaceholders` (fails closed, names each offender), `next.config.spec.ts`,
  `turbo.json` passes the variable to `next build` (`turbo-build-env.spec.ts`).
- Link rule: `lib/home-banners.ts` `checkBannerHref` (path or `https`, with a parity spec against core) and `lib/locale-path.ts`
  `localizedHref` (plain storefront path).
- Real 404s: `(catalog)` route group without `loading.tsx` (`route-structure.spec.ts`), `[...rest]` catch-all.
- `@fluxkit/ui`: `Disclosure` (native `details`, heading inside the summary), `Breadcrumbs`, `Container`, `textStyles`, `TrustBar`
  (its item text is a plain `string`, so it cannot hold a link; see decision 6).
- Home `richText` paragraphs (blank line = new paragraph), `seo.ts` `breadcrumbJsonLd`, `sitemap.ts` `buildSitemap`.
- Footer budget: `shell.spec.tsx` (footer < 1400 bytes with sentinel messages), e2e `pre-hydration-forms.e2e.ts` (uk and en register
  form inline before hydration; README "Keep the header small": about 0.3 KB headroom in uk on 2026-11-05).
- Demo pictures: `scripts/generate-demo-images.mjs --only banner-` (sharp of `apps/api`).

## Design

1. **Pages config** `src/config/shop-pages.ts`: `shopPages: readonly ShopPageConfig[]` (`slug`, `titleKey`, `descriptionKey`, `inFooter`,
   `sections`). Section kinds: `text` (optional title, body key; blank line = paragraph), `table` (title, caption, column label keys,
   rows of cell keys: the delivery rows and the size chart), `faq` (question/answer key pairs, rendered as `Disclosure`s, closed),
   `contacts` (the contacts block). A fork removes a page from the list to turn it off (its link, sitemap entry and route disappear).
   `productNote` (`summaryKey`, linked slugs) feeds the product page note. All texts are keys of the new `shopPages.*` namespace.
2. **Route** `app/[locale]/(pages)/[page]/page.tsx` (new route group without `loading.tsx`, layout re-exported from `(site)` like
   `(catalog)`): URLs `/{locale}/<slug>`. An unknown or removed slug calls `notFound()` before anything streams: a real 404
   (added to `route-structure.spec.ts`). Metadata: title, description, canonical and hreflang (`shopPageMetadata`), indexable.
   Breadcrumbs Home / title with JSON-LD. One `h1`; section titles `h2`. Enabled pages are added to the sitemap.
3. **Contacts** `src/config/contacts.ts`: phones (`tel` in E.164 + display text), email, address and working-hours message keys,
   messenger/social links (`https` only through `checkBannerHref`, label keys), optional map link (`https`). `contactsView()` validates and
   drops empty parts; every block renders only what is set (all empty = nothing, never an empty label). Demo values are honest
   placeholders: `shop@example.com`, a phone in the unassigned `+380 00` range, "1 Example Street", no messenger links.
4. **Footer**: a second short list (the pages with `inFooter`) and the phone and email links, with single `.fk-*` classes in
   `@layer components`. Measured against `shell.spec.tsx` and `pre-hydration-forms` (uk and en); if over budget, links move to page
   content instead (reported with numbers).
5. **Product note** under the trust bar in `product-purchase.tsx`: the delivery page's summary and links to the delivery and returns pages;
   static text, no layout shift; hidden when no linked page is enabled.
6. **Trust bar contact tile as a link**: `TrustBarItemConfig.href` (a shop page slug). `@fluxkit/ui` `TrustBar` takes text only and
   `packages/ui` is out of bounds, so `StoreTrustBar` renders the same list markup itself (same classes and `data-trust-bar`); a follow-up can
   add an additive `href` to the ui component. A link to a disabled page renders as plain text.
7. **Demo copy and the release check**: new file `src/config/demo-content.json` (dependency-free, read by the app and by `next.config.ts`):
   the shop pages, `contacts`, `home` (hero and "About the shop" texts) and `trustBar` that still show template copy. With
   `STOREFRONT_REQUIRE_LEGAL_TEXT=true` the build refuses while any entry is still listed/`true` (named per entry, fails closed when the
   file is missing or malformed); a fork clears an entry when it replaced that content. The legal marker stays in the `legal.*` messages
   (so the existing check still forces the texts themselves to be replaced) but is no longer shown: the page strips it and keeps the
   "Template placeholder" box while it is there. `[має заповнити магазин]` and the "About the shop" `TODO`/path text become neutral copy.
   Seed banners: neutral texts (existing rows untouched, as today), the picture banner's words regenerated.

## Files

`apps/storefront`: `src/config/{shop-pages.ts,contacts.ts,demo-content.json,trust-bar.ts,legal.ts}`, `src/lib/{shop-pages.ts,contacts.ts,
page-metadata.ts,sitemap.ts,sitemap.server.ts}`, `src/components/{shop-page.tsx,contact-details.tsx,site-footer.tsx,trust-bar.tsx,
legal-page.tsx,product-purchase.tsx (one line)}`, `src/app/[locale]/(pages)/**`, `src/app/globals.css`, `src/layout/navigation.ts`,
`src/messages/{uk,en}.json` (new `shopPages.*`, `contacts.*`; edited `home.*`, `legal.identity.unset`, `legal.updated.unset`, `footer.*`),
`next.config.ts`, specs, e2e (`shop-pages.e2e.ts` new; `privacy`, `home-banners`, `design-b` updated), README.
`seeds/src/banners.ts`, `seeds/assets/banner-collection-{uk,en}.webp`, `scripts/generate-demo-images.mjs`.
Docs: `docs/files/storefront.md`, `docs/contracts/config.md`, `.env.example` comment, `docs/privacy/README.md` (marker no longer visible),
`CHANGELOG.md`, `docs/HANDOFF.md`.

## Risks

- Footer bytes push `/uk/account/register` over the 12.8 KB first-pass limit (form outlined without a script). Mitigation: measure; fall back
  to page content.
- A top-level dynamic segment under the locale: every unknown single-segment path now reaches `[page]` instead of `[...rest]`; both call
  `notFound()` without a loading view (e2e `not-found` covers `/en/no-such-page`).
- The release check covers more: a fork that set `STOREFRONT_REQUIRE_LEGAL_TEXT=true` must now also clear `demo-content.json` (documented,
  CHANGELOG line).
- Contact demo values must never reach a real person: `example.com` and the unassigned `+380 00` range.

## Verification

`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, `pnpm --filter @fluxkit/theme test`, storefront unit
tests, seeds tests, the API seed spec, the full storefront e2e suite on private ports (Postgres 5570, Redis 6470, Meilisearch 7870,
3370 to 3379), screenshots before and after (uk/en, light/dark, 390/1280).

## Results

- **Built as designed**, items 1 to 6. Route `/{locale}/<slug>` in the new group `(pages)`; `RESERVED_SLUGS` refuses a slug another route owns
  (a spec compares it with the route folders). Sitemap lists the enabled pages. The trust bar's delivery line links too (not only the contact line).
- **Failing first:** the legal-page test `expected '<div class="mx-auto ...' not to contain 'TODO'` (uk privacy) before `withoutLegalMarker`; the
  messages test `uk home.about.body: expected 'TODO(fluxkit): демонстраційний текст.…' not to match /TODO|FIXME|fluxkit\)/i` before the new copy; the seed
  test `expected 'TODO(fluxkit): демо-банер. Замініть а…' not to match ...` before the new banner texts. All pass after.
- **Footer budget (measured):** real messages uk 1 448 bytes / en 1 265 (uk 1 367 before); sentinel 1 372 (pin < 1 400, 1 261 before). Reached by class-less
  footer lists, links and `<address>` (`.fk-site-footer` selectors), single classes for the theme switch's form and group, and by dropping catalog, cart and
  account from the footer (the header shows all three). Before that last step the sentinel footer was 1 469 (over the pin) while the e2e still passed.
  Margin probe (padding `footer.powered` in uk, real build, `pre-hydration-forms` uk register): +350 bytes still inline, +500 outlined (an earlier, heavier
  version: +100 inline, +250 outlined).
- **Decisions outside the plan:** (a) catalog, cart and account links removed from the footer and their `footer.*` messages deleted (budget); (b) the
  delivery trust line also links to its page; (c) the hero subline ("your shop's welcome text will go here") became neutral copy too, covered by
  `demo-content.json` `home`; (d) `trustBar` added to `demo-content.json`, so the release check now covers the trust bar (PR 217 review m8);
  (e) the legal marker stays in the messages and is stripped on render (keeps the existing check forcing the texts to be replaced).
- **Checks (each exit code read):** `pnpm lint` 0, `format:check` 0, `typecheck` 0, `check:boundaries` 0 (2 729 modules, 0 violations), `check:env` 0,
  `check:docs` 0, `pnpm --filter @fluxkit/theme test` 0 (97), storefront unit 0 (111 files, 2 015 tests), seeds 0 (20), API `src/seed/seed.spec.ts` 0 (51,
  real Postgres 16). Full storefront e2e, search on, Postgres 16/Redis/Meilisearch 1.55 native: 163 passed, 4 skipped (the search-off file), run twice
  (before and after a container restart), including `pre-hydration-forms` uk and en and the new `shop-pages.e2e.ts`.
- **Screenshots** before/after (uk/en, light/dark, 390/1280: home footer, a shop page (before: the privacy page), the product page) in the agent's scratchpad.
- **Not verified:** `E2E_SEARCH=off`; the admin suites (admin untouched); a screen reader, Safari, Firefox; messenger and map links in a browser (unit only,
  master sets none); a real release build with `STOREFRONT_REQUIRE_LEGAL_TEXT=true` (unit-tested only, as before); no independent review yet.
- **Open:** `@fluxkit/ui` `TrustBar` could take an optional link (then `StoreTrustBar` can use it again); owner to review the demo copy of the shop pages
  and contacts; seeded banner rows of an existing database keep their old texts (the seed never overwrites a row).

## Review fixes (PR 232, independent review: no blocker)

- **m1:** the contact email refuses `?`, `&`, `=` and `%` in the local part too (`%` dropped from the allowed characters; plus-addresses stay valid);
  spec cases `shop?subject=x@example.com`, `shop&cc=x@example.com`, `shop=x@example.com`, `shop%3Fsubject%3Dx@example.com`.
- **m2:** `checkShopPages` refuses a "See also" link to a slug outside `knownShopPageSlugs` (new runtime list; `ShopPageSlug` is derived from it); a
  known page that is not enabled stays allowed and is dropped by `shopPageLinks`. Spec added.
- **m3:** `config/contacts.ts` and the README say a malformed contacts config fails every page at request time (root layout); the spec catches it in CI.
- **m4:** the locale codes are in `RESERVED_SLUGS`; spec added.
- **m6:** docs name the trust-bar item `{icon, messageKey, page?}`; HANDOFF and Status name PR 232 and the review; `demoContentLeft` names the file on
  malformed JSON (spec asserts the message).
- **m8:** a `<br>` between the footer's phone and email (and between several phones): real whitespace for reader mode and copied text, no box in the flex
  row. Footer re-measured: uk 1 453 / en 1 270 real, 1 377 sentinel (pin < 1 400).
- Failing first: with the fixes reverted and the new specs kept, 5 tests fail (email refusal, malformed-JSON message, footer separator, unknown "See
  also" slug, reserved locales); all pass with the fixes (storefront unit: 111 files, 2 017 tests).
- Not changed: M1 (demo copy that reads like promises, guarded by the opt-in release list) is an owner decision; m5, m7, m9 skipped as instructed.
- Checks after the fixes: lint (one `preserve-caught-error` fixed: the parse error is the `cause`), format, typecheck, check:docs, check:env,
  check:boundaries, theme tests, storefront unit (2 017) and seeds (20) exit 0. Full storefront e2e on the fixed build: 163 passed, 4 skipped, including
  `pre-hydration-forms` uk and en. An earlier full run had one failure in `mobile-ux.e2e.ts` (D-04: Escape does not hide the header search row); it
  failed 2 of 5 repeats on this branch and 1 of 5 on a build of `main`'s storefront (`3760110`): a pre-existing flake, not fixed here.
