# @fluxkit/storefront

Next.js 16 (App Router, Turbopack) customer storefront. Plan: `docs/plans/2026-10-18-storefront.md`, decisions: ADR 0026, rules: `AGENTS.md` section 2.2 (theming, i18n, layout composition) and `apps/storefront/AGENTS.md` (read the Next docs in `node_modules/next/dist/docs/` before writing Next code: this version differs from older knowledge).

Status (step 4b of the plan): the shell. Header, footer, skip link, locale switcher, loading/error/not-found views, the home page as configuration, money and date formatting, the problem-message map, security headers and the server data layer exist. The catalog, product, cart, checkout and account pages are later steps; links to them in the header and footer lead to the translated 404 page until then.

## Run

```
pnpm build                                       # once, so the workspace packages exist (the storefront build needs NO running API)
pnpm --filter @fluxkit/storefront dev -p 3001    # development; needs API_INTERNAL_URL (root .env or shell) and the API on :3000
pnpm --filter @fluxkit/storefront start -p 3001  # after `pnpm build`
pnpm --filter @fluxkit/storefront test           # Vitest (unit and renderToStaticMarkup component tests)
```

`next.config.ts` loads the root `.env` for `dev` and `start` (shell variables win). Variables (`docs/contracts/config.md`):

| Variable | Read when | Used for |
|---|---|---|
| `API_INTERNAL_URL` | per request, by the server data layer (and by `next dev` for the `/store/*` rewrite) | catalog reads from the Next server. Missing or malformed: the request fails loudly, the build is unaffected |
| `STOREFRONT_PUBLIC_URL` | per request (required when `NODE_ENV=production`; validated together with the others by `loadStorefrontEnv`) | canonical URLs and the sitemap (step 5) |
| `STOREFRONT_IMAGE_HOSTS` | **at `next build`** (see the CSP section) | `img-src` of the Content-Security-Policy |

## Rendering and caching (verified against Next 16.4.1)

- **Every page under `[locale]` renders per request** (`ƒ` in the `next build` table), because the shell reads the API (categories, config). `generateStaticParams` returns the locales but prerenders nothing. HTML is sent with `Cache-Control: private, no-cache, no-store`.
- **How it is made dynamic:** `lib/store-data.server.ts` awaits `connection()` (`next/server`) before any API read, so a catalog read can never run while Next prerenders. `next build` therefore never calls the API and passes without `API_INTERNAL_URL` (checked: `env -u API_INTERNAL_URL pnpm build`). Nothing in a layout or page needs `export const dynamic`.
- **API responses are cached, not pages:** `fetch(..., { next: { revalidate: 60, tags } })` (`CATALOG_REVALIDATE_SECONDS`, an internal constant in `lib/store-data.ts`). Measured: five page requests produce one `GET /store/config` and one `GET /store/categories`.
  - The Next 16 docs say `dynamic = "force-dynamic"` is equivalent to `fetchCache = 'force-no-store'`. Measured on 16.4.1: with `force-dynamic` on the layout the explicit `revalidate` was still honored (one call each for five requests). `connection()` is used anyway because it is structural (it sits in the data layer, not in each file) and leaves routes that never read the API free to be static.
  - The data cache is on disk (`.next/cache/fetch-cache`) and survives a restart: a restarted server can serve an entry from before the restart until it is revalidated. Delete the folder to reset it.
  - When the API fails after an entry expired, Next serves the stale entry and revalidates in the background (measured with a stub API that began answering `503`: pages kept the old categories). On top of that `store-data.ts` keeps the last good response per request in memory (200 entries per process) and serves it when the API cannot be reached or answers 5xx, with a logged warning. With neither, it logs the error and throws `StoreUnavailableError`: the route's `error.tsx` renders. A `4xx` problem (a missing product) is an answer, not an outage, and is returned to the page. There is no silent fallback data.
- **Locale check** (`lib/locale-check.ts`, `app/[locale]/(site)/layout.tsx`): on every request each locale of `@fluxkit/ui` must be in the cached `GET /store/config` `locales`; otherwise a logged `LocaleMismatchError` and `error.tsx` (HTTP 500). It lives in `(site)/layout.tsx`, below the locale layout, so the header and footer still render around the error.
- **Finding (Next 16.4.1, reproduced with a minimal app, not specific to this code):** a `notFound()` or an error thrown before the first byte is streamed answers the right status (404, 500) with an HTML document whose `<body>` is empty (`<html id="__next_error__">`); the browser completes the page from the embedded RSC payload (which contains the shell and the translated content: checked in the payload, NOT in a browser, none is available in this environment). With a `loading.tsx` above the page the shell streams first: full server-rendered HTML, but the status is `200` (plus `<meta name="robots" content="noindex">`). Consequences: `[locale]/[...rest]/page.tsx` (unknown paths under a locale) lives outside `(site)` on purpose, so it keeps a real 404. **Step 5 should not put the product page under `(site)/loading.tsx`** if it wants a 404 status for an unknown slug (split `(site)` into route groups when the product route is added). An unknown first segment (`/foo`) gets Next's built-in untranslated 404 (a root layout under a dynamic segment cannot render one; `global-not-found` is experimental and not enabled).
- `next/link` is used for navigation inside a locale; the locale switcher uses plain `<a>` on purpose (a language change is a full page load: `<html lang>`, messages and the islands start from the new locale).

## Content-Security-Policy and headers (`next.config.ts`, `headers()`)

Applied to every path: `Content-Security-Policy` (`default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data:` plus `https://<host>` for each `STOREFRONT_IMAGE_HOSTS` entry; `connect-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (the guest order page will override it with `no-referrer`), `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `Strict-Transport-Security: max-age=31536000` outside `next dev`. No nonces (owner answer 13): acceptable only because no third-party script is loaded and no HTML from the API is rendered. `next dev` adds `'unsafe-eval'` and `ws:`/`wss:`.

- **`STOREFRONT_IMAGE_HOSTS` is read at build time:** Next evaluates `headers()` during `next build` and stores the result in `.next/routes-manifest.json`. Verified: a build without the variable and a `next start` with it kept `img-src 'self' data:`; a build with it contains the host. Change the variable, rebuild.
- The header code lives in `next.config.ts` itself: Next compiles only that one file for its config, and a relative import of another TypeScript file fails with `MODULE_NOT_FOUND`.

## Structure

See `docs/files/storefront.md` for one line per file. In short:

- `src/app/[locale]/` routes only compose. `layout.tsx` is the root layout (`<html lang>`, `SiteShell`); `(site)/` holds the pages that need the locale check and the loading state; `error.tsx`, `not-found.tsx` and `[...rest]` are the error states.
- `src/components/`: storefront components; dumb token-styled parts come from `@fluxkit/ui`. Client islands (`'use client'`): `cart-badge`, `account-link`, `locale-switcher`, `i18n-provider` and the three tiny route files for loading, error and not-found. The pure `*View` components next to them are what the tests render.
- `src/lib/`: logic without markup (`money`, `date`, `problem-messages`, `store-data` and `store-data.server`, `locale-check`, `locale-path`, `session-state`, `client-messages`, `navigation-categories`).
- `src/layout/` and `src/config/`: configuration (below). `src/messages/`: `uk.json`, `en.json`.

### Layout composition is configuration

- Home page: `src/layout/home.ts` lists the sections in order with props (message keys, a `limit`); `components/home-sections.tsx` has the registry (one renderer per section type). `categoryTiles` and `newProducts` render an empty state until step 5 supplies data.
- Header and footer links: `src/layout/navigation.ts` (message keys and locale-less paths; `localizedHref` adds the locale and refuses anything that is not a plain path).
- Checkout settings (allowed shipping countries, default country `UA`, which address fields are shown): `src/config/checkout.ts`, consumed by step 7.

**Add a home section:** add a member to the `HomeSection` union and an entry to `homeSections` in `layout/home.ts`, and a renderer in `homeSectionRegistry` (TypeScript fails until both exist). **Add a header or footer link:** add `{ labelKey, href }` to `navigation.ts` and the message key to both JSON files.

### i18n

- Every user-facing string is a message key in `src/messages/{uk,en}.json`; components receive a translator (`createTranslator(messages, locale)` from `@fluxkit/ui`), a missing key or placeholder value throws. Server components build it from `messagesByLocale`; client components use `useI18n()`.
- **Client subset:** only keys with a prefix in `lib/client-messages.ts` (`nav.`, `locale.`, `error.`, `errors.`, `notFound.`, `loading.`) are serialized into the page for the browser. A client component that needs a new namespace must add its prefix there.
- **Add a message:** add the key to BOTH files. Plural forms are separate keys (`nav.cart.items.one|few|many|other` for `uk`, `one|other` for `en`, each with `{count}`), used with `t.plural(key, count)`. `messages/messages.spec.ts` fails on: a key in one file only, different `{placeholders}`, an incomplete plural group, and a string literal in the source that looks like a key but is not in the files.
- **Problems from the API** (`lib/problem-messages.ts`): only translated messages are shown, never the API's `detail` or `message`. `errors.<code>` for a problem `code` (every value of `ProblemDetailsDoc.code`; a test compares the list with `docs/api/openapi.json`), `errors.rule.<rule>` for a `rule_violation` rule, `errors.field.<code>` for an `errors[].code`, `errors.network` and `errors.invalidResponse` for the client's thrown errors, `errors.generic` for anything unknown (the unknown code is logged with `console.warn` in development only). A new API code fails the test until it gets a decision and a message.
- Money and dates: `lib/money.ts` (`formatMoney({amount, currency}, exponent, locale)`: the amount becomes a decimal string with BigInt arithmetic and `Intl.NumberFormat` formats the string; the exponent is the shop's `currencyExponent` from `GET /store/config`, falling back to Intl's digits for the currency; the storefront never adds or multiplies money) and `lib/date.ts` (`Intl.DateTimeFormat`; an invalid date throws).

## Accessibility baseline (what was checked)

By tests (`components/shell.spec.tsx`, markup assertions) and by `curl` of the running app:

- Landmarks: one `header`, `main` and `footer`; three `nav`s (main, locale switcher, footer), each with a translated `aria-label`. `<html lang>` is the route's locale; the locale links carry `lang` and `hrefLang`; the current locale has `aria-current`.
- Skip link: the first element in `<body>`, `href="#main-content"`; `<main id="main-content" tabindex="-1">` receives the focus when the link is followed. It is visible only while focused (classes of the `@fluxkit/ui` component).
- Focus: visible keyboard focus comes from the `ring` token (`focus-visible:outline-ring` on every link and button class in `components/styles.ts` and `@fluxkit/ui`). Contrast of the documented token pairs is a theme test (step 4a).
- Headings: one `h1` per page; the home outline is h1, h2, h3 without skips (tested). The error and not-found views have their own `h1`.
- Live regions and shifts: the cart badge and the account link keep a fixed-width slot in every state (`min-w-8`, `min-w-28`: skeleton while loading, count or text when ready, empty when the cart could not be read), with visually hidden loading text; skeletons respect `prefers-reduced-motion`.
- No hardcoded text: every shell component is rendered with a sentinel translator and no word may remain outside the sentinels, in text or in `aria-label`, `alt` or `title` (a test).

NOT checked (no browser or screen reader here): a real keyboard walk, focus order after the client islands load, screen-reader output, the client-rendered error and not-found pages, reflow at 320 px.

## Bundle (step 4b check)

`pnpm build` prints no sizes in Next 16; `.next/diagnostics/route-bundle-stats.json` has them. First-load JS of `/[locale]` (the home page): **485,404 bytes uncompressed, about 146 KB gzip**. The bare `/_not-found` route is 456,219 bytes (React, Next and the router), so the app itself adds about 29 KB uncompressed. `@fluxkit/core`, `@fluxkit/config` and zod are NOT in any client chunk (all `.next/static/chunks/*.js` were searched for their code); `@fluxkit/api-client` and the `@fluxkit/ui` translator are. `client-boundary.spec.ts` fails if a `'use client'` file imports a `*.server` module, `@fluxkit/config`, `@fluxkit/core` or `next/server`, or if any storefront file imports `@fluxkit/core`. The plan's question whether to use the core validators on the client is decided when a form needs them, with a new measurement.

## Known limits and TODOs

- `TODO(fluxkit)` the locale switcher keeps path and query but not the URL fragment; the guest order page (step 7, token in the fragment) must handle that.
- `TODO(fluxkit)` `categoryTiles` and `newProducts` are empty-state placeholders until step 5.
- `components/styles.ts` repeats the `focusRing` class of `@fluxkit/ui` (not exported there) and defines link styles because `@fluxkit/ui` has no link-styled button; an exported `focusRing` and a `ButtonLink` in the UI library would remove the duplication.
- There is no `global-error.tsx`: an error in the root layout itself (for example a missing `API_INTERNAL_URL`) shows Next's built-in error page.
