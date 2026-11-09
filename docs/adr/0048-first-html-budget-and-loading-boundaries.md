# 0048. First HTML: no loading view above the pages that must work before hydration, no boundary around the header search box

Status: accepted (owner decision 2026-11-09, together with the header search box change: no `Suspense`, `SearchBoxFallback`
removed). Proposed 2026-11-08 (plan `docs/plans/2026-11-08-design-changeability.md`, work package L1, PR-B; branch
`spike/l1-first-html`, PR 238). Replaces the first-HTML byte budget recorded in `apps/storefront/README.md`
("Keep the header small") and pinned by `shell.spec.tsx` (header under 3 700, footer under 1 400 bytes). No public contract changes
(URLs, API, config, tokens and messages are unchanged).

## Context

### Verified in the code (2026-11-08)

- **Outlining rule.** `flushSegment` in `react-dom-server.node.production.js` (react-dom 19.3.1 in `node_modules`, and the copy Next
  16.4.3 actually uses for the app router, `next/dist/compiled/react-dom`, version `19.3.0-canary-278794d7-20261002`; same code): a
  FINISHED Suspense boundary is written out of place (`<template id="B:n">` and the fallback in place, the content later in
  `<div hidden id="S:n">` plus an inline `$RC` call) when
  `isEligibleForOutlining(boundary) && (flushedByteSize + boundary.byteSize > progressiveChunkSize || hasSuspenseyContent(...) || boundary.defer)`.
  `isEligibleForOutlining` needs `boundary.byteSize > 500` (or suspensey content, or `defer`) and no preamble; `progressiveChunkSize`
  is 12 800 bytes by default. At the shell flush `flushedByteSize` starts at the byte size of the WHOLE shell (`request.byteSize`), so
  every boundary inside the shell is outlined once the shell is big, whatever its position. Outside the shell flush a boundary that
  holds a stylesheet resource is always outlined.
- **No option in Next.** Next 16.4.3 passes `progressiveChunkSize` only to `getServerInsertedHTML` (1 MiB, never sent,
  `dist/server/app-render/make-get-server-inserted-html.js`); the page render takes React's default; `next.config` has no option.
- **The race.** Independent of bytes: a page boundary still pending when the shell flushes (data or RSC chunk not there yet) is
  written as its fallback, and the page arrives later as an `S:` segment. Without a script it never becomes visible.
- **The reveal is late.** The inline `$RC` does not swap at once: it queues the boundary and reveals it in a `requestAnimationFrame`,
  later ones throttled to 300 ms after the previous reveal (with a special window at 2.0 to 2.3 s). Text typed into the fallback
  before the reveal is thrown away with the fallback.
- **The header search box was such a boundary.** `site-header.tsx` wrapped `SearchBox` in `<Suspense fallback={<SearchBoxFallback />}>`
  because of `useSearchParams`. In a request render `useSearchParams` does not suspend (`dist/server/app-render/dynamic-rendering-client.js`,
  `useDynamicSearchParams` throws only for `prerender-*` work units; every storefront page renders per request). So the boundary was
  always finished, inline while the shell was small and outlined once it passed 12 800 bytes (the catalog, category and product pages
  have big shells: the "streams in" of the old comment). The mobile-ux D-04 flake had the same cause (PR 240 found it: a row
  opened while the box's boundary was still dehydrated); with the boundary removed and PR 240's `data-hydrated` wait removed too,
  D-04 and the toast test passed 30 of 30 each with `--repeat-each 30` and no retries (CI run 42600373471, job 129103174576,
  2026-11-09).
- **Route groups before this ADR.** `app/[locale]/(site)/loading.tsx` sat above every `(site)` page: home, the account pages, cart,
  checkout, the guest order page, the payment return page and the legal pages. `(catalog)` and `(pages)` have no `loading.tsx` on
  purpose (real 404s, `route-structure.spec.ts`); `[...rest]` is outside every group.
- **What is awaited before the shell flushes.** Root layout: `navigationCategories(locale)` then `headerSearchEnabled()`
  (`GET /store/categories`, `GET /store/config`, 60 s Next data cache) and `cookies()`. `(site)/layout.tsx`: `ensureStorefrontLocales()`
  (`GET /store/config`). Pages: login, forgot, reset, verify and account overview `getEmailDelivery()`; cart `getShopExponent()`;
  checkout `getShopExponent()` and `getOnlinePayment()`; guest and customer order pages `getShopMoney()` and `getOnlinePayment()`;
  customer order list `getShopMoney()`; register, profile, data, deleted, payment return and legal pages only the locale. All read the
  same cached `GET /store/config`. The home page streams its sections in their own boundaries (`components/home-sections.tsx`).
- **History.** The header and footer were shrunk four times because the `(site)` loading view plus a bigger header outlined
  `/uk/account/register` or `/en/account/login`; a four-column footer (2 809 to 2 816 bytes) outlined the English register form again
  (plan, R4). Design batch B lost text typed into the header search box in 5 of 40 runs when the home page left `(site)`.

### Pages that must render before hydration

Login, register, forgot-password, reset-password, verify-email, cart, checkout, the three legal pages, the payment return page and the
guest order page. The sign-in, registration and forgot-password forms post natively without a script (`pre-hydration-forms`); the
others show their server shell (heading, notices, the island's own loading state) instead of the route's loading view. The reset and
verify pages read their token from the URL fragment, so their form or status appears with the script; their shell must still be inline.

## Measurements (CI, e2e job "End-to-end (Playwright, Chromium)", Chromium, 2026-11-08)

Stress = header +1.5 KB and footer +2.8 KB of scratch markup (a client-sized header and a four-column footer), every API read of the
Next server uncached and delayed 500 ms by a proxy, Playwright retries off. Search = `header-search-pre-hydration.e2e.ts`: scripts held
until "викрут" is typed into the header box, then released; a run fails when the text is gone after hydration or no suggestion comes.
Bytes are from the raw HTML of `/{locale}/account/register` (head, header, footer, offset of the page's form; "out" = in a hidden segment).

| Candidate | Run (job) | Register uk: head / header / footer / form | Register en | Forms (login, register, forgot) uk + en | Outlined segments | Search losses (/uk, login, catalog) | CLS (4 pages x 390/1280 x cold/warm) |
|---|---|---|---|---|---|---|---|
| main layout, stressed | 6 (128861022492) | 1 275 / 6 518 / 4 518 / out | 1 192 / 6 249 / 4 335 / out | outlined, `pre-hydration-forms` 4 of 4 no-JS tests fail | uk: search form + page; en: page | 19/40, 26/40, 19/40 | 0.0000 |
| (a) loading only on home, unstressed (run 1 failed for unrelated reasons: a bug of the new `first-html` test on reset-password, fixed in `c8491b2`, plus the `account-email` and mobile-ux D-04 flakes, both passed on retry; run 4 passed) | 1 (128848778391), 4 (128856481676) | 1 345 / 4 832 / 1 497 / 6 809 | 1 262 / 4 594 / 1 314 / 6 457 | inline | none (24 routes) | 0/40, 0/40, not run | 0.0000 |
| (a), stressed | 3 (128851932335) | 1 205 / 6 518 / 4 518 / 8 355 | 1 122 / 6 280 / 4 335 / 8 003 | inline | one per page (the header search box) | 25/40, 18/40, not run | 0.0000 |
| (a2) = (a) + no boundary around the search box, stressed | 5 (128858612236) | 1 205 / 6 470 / 4 518 / 8 307 | 1 122 / 6 232 / 4 335 / 7 955 | inline | none (24 routes) | 0/40, 0/40, 0/40 | 0.0000 |
| (a2), unstressed, full suite (storefront 324 and admin 61 passed, none flaky) | 7 (128867155370) | 1 345 / 4 815 / 1 497 / 6 792 | 1 262 / 4 577 / 1 314 / 6 440 | inline | none (24 routes) | 0/40, 0/40, 0/40 | 0.0000 |

Notes: the final commit of the PR passed the full suite again (run 8, job 128871021231: storefront 207 and admin 61 passed).
Every CLS value read 0.0000 with the collector that measured 0.261 in design batch B (now `e2e/support/layout-shift.ts`); the
home page's loading view is a screen tall, so replacing it moves nothing on screen. The pages of `(site)` other than home lost their
loading view; a client-side navigation to them keeps the previous page until the new one is rendered, as the `(catalog)` pages always
did. Candidate (d) "footer after the content" was not measured: (a2) met every criterion.

## Decision

1. **Loading views per route group.** Only the home page keeps a route-level loading view: `app/[locale]/(site)/(home)/loading.tsx`
   with `(site)/(home)/page.tsx` (a nested route group: the URL `/{locale}` and the `(site)` layout are unchanged). Every other page of
   `(site)` renders inside the shell. `route-structure.spec.ts` lists the pages that must render before hydration, fails if a
   `loading.tsx` appears above one of them, and fails on any `loading.tsx` other than the home page's. A new loading view is a
   decision recorded here, not a default.
2. **No Suspense boundary around anything in the shell that a shopper can type into or must use without a script** (today: the
   header search box). `SearchBoxFallback` is removed. Should a page ever be prerendered statically, `useSearchParams` without a
   boundary fails `next build` loudly (`BailoutToCSRError`), not silently: for example a fork that adds a root `app/layout.tsx`
   rendering `SiteShell` plus an app-level `not-found.tsx` makes `/_not-found` static and the build fails there.
3. **The byte budget becomes a loose sanity cap**: header under 8 000 and footer under 4 000 bytes in `shell.spec.tsx` (they only catch
   a runaway header or footer, which every page carries). The guards of the first HTML are the e2e tests `pre-hydration-forms` (uk and
   en), `first-html` (raw HTML of the 12 pages in uk and en: the form inside `<main>`, no pending boundary in `<main>`, no loading view,
   no page form in a hidden segment; CLS under 0.05 on `/uk`, `/uk/catalog` and the register page in uk and en at 390 and 1280 px, cold
   and warm) and `header-search-pre-hydration` (home, sign-in and catalog).
4. **Home works only with a script for its streamed sections (accepted).** Its hero and section headings are in the first HTML after
   the loading view is replaced; the sections arrive as segments. Its LCP element (the hero picture, `fetchpriority="high"`) does not
   wait for the bundles.

## Consequences

- A client fork can grow the header and footer (logo, four-column footer, more categories) without moving the forms behind the
  loading view; the measured client-sized header and footer leave everything inline. The template's targets of plan section 1 that
  depended on L1 (request 5, the four-column footer) are not blocked by the first HTML any more.
- The budget protects progressive enhancement, not security: the `method="post"` guard in `source-guards.spec.ts` (no personal data in a
  URL even when a form posts before hydration) is independent of this ADR and stays.
- Boundaries that remain in the shell (the language list's `useSearchParams` boundary, small) can still be outlined in a big shell; the
  language links then appear with the script. Measured: 0 outlined segments on all 24 routes in run 5 (stressed, shells up to
  about 14.5 KB to the end of the footer, e.g. `/uk/account/login`, and about 17.5 KB on `/uk/legal/cookies`), so the language
  list was not outlined there; the cause (its size under the 500-byte eligibility limit) is a hypothesis, not checked.
- New fonts loaded through a stylesheet inside a boundary would make that boundary outlined outside the shell flush; `@font-face` stays
  in global CSS (plan T1b).
- The pages of `(site)` other than home show no loading view during a client-side navigation; their islands keep their own loading
  states (cart lines, order list, account gate).
- A new `loading.tsx`, a new Suspense boundary around an input in the shell, or a page that must work without a script but sits under a
  loading view are review findings against this ADR; the structural guard catches the first and the e2e tests the others.
