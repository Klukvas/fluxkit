# 0048. First HTML: loading views per route group instead of a byte budget

Status: proposed (2026-11-08, plan `docs/plans/2026-11-08-design-changeability.md`, work package L1, PR-B). DRAFT: the facts of the
diagnosis are verified (section "Context"); the measurements are being taken in CI on the spike branch `spike/l1-first-html`.

## Context

### Verified in the code (2026-11-08)

- **Outlining rule.** `flushSegment` in `react-dom-server.node.production.js` (react-dom 19.3.1 in `node_modules`, and the copy Next
  16.4.3 actually uses for the app router, `next/dist/compiled/react-dom`, version `19.3.0-canary-278794d7-20261002`; same code): a
  FINISHED Suspense boundary is written out of place (`<template id="B:n">` plus the fallback in place, the content later in
  `<div hidden id="S:n">` and an inline `$RC` script that swaps it in) when
  `isEligibleForOutlining(boundary) && (flushedByteSize + boundary.byteSize > progressiveChunkSize || hasSuspenseyContent(...) || boundary.defer)`.
  `isEligibleForOutlining` needs `boundary.byteSize > 500` (or suspensey content, or `defer`) and no preamble. `progressiveChunkSize`
  defaults to 12 800 bytes. During the shell flush `flushedByteSize` starts at the shell's own byte size (the `<head>` and everything
  before the boundary count) and grows with every boundary written inline; the fallback of the boundary (the loading view) is
  counted although it is not sent. Outside the shell flush, a boundary holding a stylesheet resource is always outlined
  (`hasSuspenseyContent` checks `stylesheets.size` when not flushing the shell).
- **No option in Next.** Next 16.4.3 passes `progressiveChunkSize` only to `getServerInsertedHTML` (1 MiB, not sent over the network,
  `dist/server/app-render/make-get-server-inserted-html.js`); the page render takes React's default. No `next.config` option exists.
- **The race.** Independent of bytes: if the page boundary is still pending when the shell flushes (its data or its RSC chunk not
  there yet), React writes the fallback in place and the page later as a separate `S:` segment. Without a script it never becomes
  visible. Only a route WITHOUT a `loading.tsx` above it puts the page into the shell itself (the shell waits for the page).
- **Route groups before this ADR.** `app/[locale]/(site)/loading.tsx` sat above every `(site)` page: home, the account pages
  (login, register, forgot-password, reset-password, verify-email, overview, profile, orders, data, deleted), cart, checkout, the
  guest order page, the payment return page and the legal pages. `(catalog)` (catalog, category, product, search) and `(pages)`
  (shop pages) have no `loading.tsx` on purpose (real 404s, `route-structure.spec.ts`); `[...rest]` is outside every group.
- **What is awaited before the shell can flush.** Root layout `app/[locale]/layout.tsx`: `navigationCategories(locale)` then
  `headerSearchEnabled()` (`GET /store/categories`, `GET /store/config`, both through the 60 s Next data cache) and `cookies()`.
  `(site)/layout.tsx`: `ensureStorefrontLocales()` (`GET /store/config`). Pages: login `getEmailDelivery()`; forgot, reset and
  verify `getEmailDelivery()`; account overview `getEmailDelivery()`; cart `getShopExponent()`; checkout `getShopExponent()` and
  `getOnlinePayment()`; guest and customer order pages `getShopMoney()` and `getOnlinePayment()`; customer order list
  `getShopMoney()`; register, profile, data, deleted, payment return and legal pages nothing beyond the locale. All of them read
  the same cached `GET /store/config`. The home page streams its sections in their own boundaries (`components/home-sections.tsx`).
- **History.** The header (`shell.spec.tsx` pin 3 700 bytes) and the footer (pin 1 400, 1 377 used) were shrunk four times
  (README "Keep the header small") because the `(site)` loading view plus a bigger header outlined `/uk/account/register` or
  `/en/account/login`. A four-column footer (2 809 to 2 816 bytes) outlined the English register form again (plan, R4).

### Pages that must render before hydration

Login, register, forgot-password, reset-password, verify-email, cart, checkout, the three legal pages, the payment return page and
the guest order page: the forms post natively without a script (`method="post"` guard in `source-guards.spec.ts`, e2e
`pre-hydration-forms`), and the other pages show their server shell (heading, notices, the island's own loading state) instead of
a blank loading view.

## Decision

Pending the measurements (section "Measurements"). The candidate under test, (a):

1. Only the home page keeps a route-level loading view: `app/[locale]/(site)/(home)/loading.tsx` with `(site)/(home)/page.tsx` (a
   nested route group: the URL `/{locale}` is unchanged, the `(site)` layout with its locale check is shared).
2. Every other page of `(site)` renders inside the shell: no `loading.tsx` above it. `route-structure.spec.ts` lists the pages that
   must render before hydration and fails if a `loading.tsx` appears above one of them, and fails on any second `loading.tsx`.
3. The byte pins of `shell.spec.tsx` become a loose sanity cap (header under 8 000, footer under 4 000 bytes); the guards of the
   first HTML are the e2e tests `pre-hydration-forms` (uk and en) and `first-html` (raw HTML).

## Measurements

Pending (CI on `spike/l1-first-html`).

## Consequences

Pending.
