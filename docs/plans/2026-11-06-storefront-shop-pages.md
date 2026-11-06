# Plan: storefront shop pages, contacts, footer and demo copy (repair batch 2)

Status: implemented on `feature/storefront-shop-pages` (from `origin/main` `3760110`), see "Results". Not opened as a PR (orchestrator's call).
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

(filled in after implementation)
