# @fluxkit/storefront

Next.js 16 (App Router, Turbopack) customer storefront. Plan: `docs/plans/2026-10-18-storefront.md`, decisions: ADR 0026, rules: `AGENTS.md` section 2.2 (theming, i18n, layout composition) and `apps/storefront/AGENTS.md` (read the Next docs in `node_modules/next/dist/docs/` before writing Next code: this version differs from older knowledge).

Status (step 5 of the plan): the catalog. On top of the shell (header, footer, skip link, locale switcher, loading/error/not-found views, money and date formatting, the problem-message map, security headers, the server data layer) the home sections, the catalog, category and product pages, SEO metadata, JSON-LD, `sitemap.xml` and `robots.txt` exist. The cart, checkout and account pages are later steps; links to them lead to the translated 404 page until then.

## Routes

| Route | Rendering | Data (all through the 60 s data cache) | Indexing |
|---|---|---|---|
| `/{locale}` | server, per request | `GET /store/products?limit=8`, `GET /store/categories`, `GET /store/config` | index, canonical, hreflang |
| `/{locale}/catalog` (`?page`, `?brand`) | server, per request | `GET /store/products?limit=24&offset=` (+ `brand`), `GET /store/config` | page 1 index; `noindex, follow` on a brand filter and on page 2 and later; canonical never has `brand` |
| `/{locale}/c/{slug}` (`?page`, `?brand`) | server, per request | categories tree (breadcrumbs, children), products with `category=` (descendants included by the API) | same rules as the catalog |
| `/{locale}/p/{slug}` | server, per request; `ProductPurchase` is a client island | `GET /store/products/{slug}`, config, categories | index, Product and BreadcrumbList JSON-LD |
| `/sitemap.xml`, `/robots.txt` | server, per request | products in pages of 100 (1 hour cache), categories | - |

- **Real 404s.** The catalog, category and product routes live in the `(catalog)` route group, which has NO `loading.tsx` (see the finding in "Rendering and caching"): `notFound()` before the first byte answers HTTP 404. `route-structure.spec.ts` fails if a `loading.tsx` ever appears above them. The cost: these pages show no loading skeleton; the whole page waits for its data (cached 60 s, so usually fast).
- **Not found, decided:** an unknown or inactive category, an unknown, unpublished or unsellable product slug (the API's 404, or its 400 for a slug over 160 characters), a malformed `page` (`0`, `-1`, `1.5`, `abc`, `01`), a `page` beyond the last page, a `page` above the API's offset cap (418 at 24 per page; the API is not even asked) and a `brand` that is not a slug are all `404`. Never silently page 1 or the last page. An empty first page (no products, an empty category, a brand with no products) is `200` with an empty state.
- **Paging.** 24 per page, `offset = (page - 1) * 24`; the API refuses `offset` above 10 000, so the last reachable page is 417 and the pager never offers more (API gap 8: a larger catalog is listed only up to there).
- **Brand filter** exists only as links (`?brand=<slug>`): the brand name on a product card or page links to the catalog (or the current category) filtered by it, and the active filter shows a "clear" link. There is no brand list and no sort control (owner answers 10 and 11). The brand name shown in the filter chip comes from a listed product.
- **Data requests.** One request per need: list items already carry price and availability (no N+1). A page and its `generateMetadata` share one load through React `cache` (`lib/catalog-pages.server.ts`). A product page reads the product, the config (`currencyExponent`) and the category tree (breadcrumbs); the last two are the same cached reads the layout makes.

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
| `STOREFRONT_PUBLIC_URL` | per request (required when `NODE_ENV=production`; validated together with the others by `loadStorefrontEnv`) | canonical URLs, hreflang, Open Graph URLs, JSON-LD, the sitemap and robots.txt |
| `STOREFRONT_IMAGE_HOSTS` | **at `next build` and again at `next start`** (see "Images") | the CSP `img-src` (build), the image optimizer's allow-list and the pages' image check (start) |

## Rendering and caching (verified against Next 16.4.1)

- **Every page under `[locale]` renders per request** (`ƒ` in the `next build` table), because the shell reads the API (categories, config). `generateStaticParams` returns the locales but prerenders nothing. HTML is sent with `Cache-Control: private, no-cache, no-store`.
- **How it is made dynamic:** `lib/store-data.server.ts` awaits `connection()` (`next/server`) before any API read, so a catalog read can never run while Next prerenders. `next build` therefore never calls the API and passes without `API_INTERNAL_URL` (checked: `env -u API_INTERNAL_URL pnpm build`). Nothing in a layout or page needs `export const dynamic`.
- **API responses are cached, not pages:** `fetch(..., { next: { revalidate: 60, tags } })` (`CATALOG_REVALIDATE_SECONDS`, an internal constant in `lib/store-data.ts`). Measured: five page requests produce one `GET /store/config` and one `GET /store/categories`.
  - The Next 16 docs say `dynamic = "force-dynamic"` is equivalent to `fetchCache = 'force-no-store'`. Measured on 16.4.1: with `force-dynamic` on the layout the explicit `revalidate` was still honored (one call each for five requests). `connection()` is used anyway because it is structural (it sits in the data layer, not in each file) and leaves routes that never read the API free to be static.
  - The data cache is on disk (`.next/cache/fetch-cache`) and survives a restart: a restarted server can serve an entry from before the restart until it is revalidated. Delete the folder to reset it.
  - When the API fails after an entry expired, Next serves the stale entry and revalidates in the background (measured with a stub API that began answering `503`: pages kept the old categories). On top of that `store-data.ts` keeps the last good response per request in memory (200 entries per process) and serves it when the API cannot be reached or answers 5xx, with a logged warning. With neither, it logs the error and throws `StoreUnavailableError`: the route's `error.tsx` renders. A `4xx` problem (a missing product) is an answer, not an outage, and is returned to the page. There is no silent fallback data.
- **Locale check** (`lib/locale-check.ts`, `app/[locale]/(site)/layout.tsx`): on every request each locale of `@fluxkit/ui` must be in the cached `GET /store/config` `locales`; otherwise a logged `LocaleMismatchError` and `error.tsx` (HTTP 500). It lives in `(site)/layout.tsx`, below the locale layout, so the header and footer still render around the error.
- **Finding (Next 16.4.1, reproduced with a minimal app, not specific to this code):** a `notFound()` or an error thrown before the first byte is streamed answers the right status (404, 500) with an HTML document whose `<body>` is empty (`<html id="__next_error__">`); the browser completes the page from the embedded RSC payload (which contains the shell and the translated content: checked in the payload, NOT in a browser, none is available in this environment). With a `loading.tsx` above the page the shell streams first: full server-rendered HTML, but the status is `200` (plus `<meta name="robots" content="noindex">`). Consequences: `[locale]/[...rest]/page.tsx` (unknown paths under a locale) lives outside `(site)` on purpose, so it keeps a real 404. **Step 5 therefore keeps the catalog, category and product routes in the `(catalog)` route group, which has no `loading.tsx`** (checked with a real run: an unknown slug answers 404; `route-structure.spec.ts` guards it). An unknown first segment (`/foo`) gets Next's built-in untranslated 404 (a root layout under a dynamic segment cannot render one; `global-not-found` is experimental and not enabled).
- `next/link` is used for navigation inside a locale; the locale switcher uses plain `<a>` on purpose (a language change is a full page load: `<html lang>`, messages and the islands start from the new locale).

## Images

Product images go through `next/image` (owner answer 7) and only for hosts in `STOREFRONT_IMAGE_HOSTS`; everything else gets the token-styled placeholder of `@fluxkit/ui` (never a broken image, never a request to an unknown host).

- **Where it is decided:** `lib/image-source.ts` `allowedImageUrl`: `https` only, no credentials, no port, hostname exactly in the list (look-alike hosts such as `cdn.example.com.evil.example` or `cdn.example.com@evil.example` fail). The server components check every URL and pass only a checked `src` or `null` to the `StoreImage` client component, which also falls back to the placeholder when the image fails to load (including a failure before hydration).
- **`STOREFRONT_IMAGE_HOSTS` is read twice (verified on Next 16.4.1, `next start` with a different value than the build):**
  1. `next build` reads it for the CSP `headers()` (stored in the build output) and for `images.remotePatterns`.
  2. `next start` evaluates `next.config.ts` AGAIN: the image optimizer allows the hosts of the variable as the server STARTS, not as it was built (build without hosts, start with `example.com`: the optimizer fetched `example.com`; build with `example.com`, start without: the optimizer answered 400 for it). The pages read the same live variable (`lib/image-hosts.server.ts`), so a page never offers an image the optimizer refuses. The CSP list keeps the build value; it is not needed for optimized images, which load from `/_next/image` (`'self'`).
  - Operate it as: set the same value for `next build` and `next start`; changing the list needs a restart, changing the CSP part also a rebuild.
- **Sizes and loading:** explicit `width` and `height` (square boxes, `object-cover`, so the space is reserved and nothing shifts), a `sizes` attribute per use, `loading="lazy"` except the first four list images and the main product image (`eager`, the main one with `fetchPriority="high"`).
- **Alt text:** the media `alt` from the API, else the product title; never empty for an informative image. The thumbnails of the gallery are decorative inside a labelled button.
- **Seed images** (`https://example.com/placeholder/...`) do not resolve, and `example.com` is not in the default list, so a fresh clone shows placeholders everywhere. With `STOREFRONT_IMAGE_HOSTS=example.com` the page emits `<img src="/_next/image?url=...">` and the optimizer answers 404 for the missing upstream file; in a browser `onError` then shows the placeholder (NOT verified here: no browser).
- Open Graph and JSON-LD use the media URL as the API gives it (a crawler fetches it directly) when it is an `http(s)` URL, whether or not its host is in the list.

## Variant picker (`lib/variant-matcher.ts`)

Pure and niche-neutral: option and value codes are data from the API; nothing knows what "size" or "color" is (`source-guards.spec.ts` fails on a quoted `size`, `color`, `material`, ... in the source).

- A product with no options has one default variant and no picker (`hasOptionPicker`). `findVariant` needs a complete selection that equals a variant exactly; otherwise `null` (the page then says the combination does not exist and disables the button).
- `initialSelection`: the first variant that is not `out_of_stock`, else the first.
- A value of option N is **available** only when some sellable variant has it together with the current values of options 1 to N-1. So the first option never has a disabled value, and `selectValue` repairs the later options when an earlier choice makes them impossible (it picks the first value that exists). The picker therefore cannot dead-end, whatever holes the variant grid has (tested exhaustively on two sparse fixtures).
- Media belonging to a selected option value is shown first (`galleryFor`), then general media, then the rest.

## Add to cart and the cart event

- `ProductPurchase` posts `POST /store/cart/items` from the browser (`lib/add-to-cart.ts`: the cart cookie has `Path=/store`, so only the browser can send it; the api-client adds `X-Fluxkit-CSRF`). Quantity 1 to 999 is checked before the request. The button is disabled while the request runs and for an `out_of_stock` variant (decision: the cart would accept such a line but the checkout refuses it; a backorder or untracked variant reports `in_stock`, so the shop's own rule decides).
- **Messages:** failures show the translated message of the problem (`errors.rule.variant_not_sellable`, `errors.rule.quantity_limit`, `errors.too_many_requests` for 429, `errors.network`, `errors.invalidResponse`, `errors.generic` for anything unknown), never the API's text. The result is announced through a `role="status"` region that is always in the page (a live region only announces changes to a region that already exists); an error is an `Alert` with `role="alert"`.
- **Cart event (`lib/cart-events.ts`, the base for step 6):** after a successful add the page dispatches `fluxkit:cart-changed` on `window` with `{ itemCount }` (the count the API returned). `watchCartBadge` (`lib/session-state.ts`) makes the header badge show the first `GET /store/cart` value and then every event; an event that arrives while the first read is in flight wins over the older read. Step 6's cart context should publish the same event from the cart page (or replace the listener with a context that feeds the badge); the badge needs no other change.

## SEO

- `generateMetadata` per page (`lib/page-metadata.ts`): title `"<page> — <site>"` (`seo.pageTitle`, with "(Page N)" on later pages), description (product and category descriptions are trimmed plain text, 160 characters, cut at a word), canonical and `alternates.languages` for every locale plus `x-default` (the default locale) from `STOREFRONT_PUBLIC_URL`, Open Graph title, description, URL, site name and the first media image.
- **Robots:** `noindex, follow` on a brand filter and on page 2 and later; everything else indexable. The canonical of a filtered view is the UNFILTERED list (same `page`), and a later page canonicalizes to itself, not to page 1.
- **JSON-LD** (`components/json-ld.tsx`, the only `dangerouslySetInnerHTML` in the app): `Product` with `offers` and `BreadcrumbList`. One price is an `Offer`; a range is an `AggregateOffer` (`lowPrice`, `highPrice`, `offerCount` = variants). Prices are decimal STRINGS from the integer minor units (`minorUnitsToDecimalString`, BigInt), availability maps to `InStock`, `LimitedAvailability` and `OutOfStock`. `serializeJsonLd` escapes `<`, `>`, `&` and U+2028/2029 as unicode escapes, so product text cannot close the script element (tested with a malicious title).
- **`/sitemap.xml`:** home, catalog, every category and every product, once per locale, each with hreflang alternates; `lastmod` is `publishedAt` (API gap 7). Products come 100 per request (first page, then batches of 8 in parallel) up to the API's offset cap, so at most 10 100 products are listed (about 20 200 product URLs, under the 50 000 a file may hold); a refused page fails the sitemap loudly. API reads are cached for 1 hour. **`/robots.txt`:** allows everything, disallows `/{locale}/cart|checkout|account|order` and `/store/`, and names the sitemap.
- Both files read `STOREFRONT_PUBLIC_URL` per request (after `connection()`), so `next build` needs no environment.

## Content-Security-Policy and headers (`next.config.ts`, `headers()`)

Applied to every path: `Content-Security-Policy` (`default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data:` plus `https://<host>` for each `STOREFRONT_IMAGE_HOSTS` entry; `connect-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (the guest order page will override it with `no-referrer`), `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `Strict-Transport-Security: max-age=31536000` outside `next dev`. No nonces (owner answer 13): acceptable only because no third-party script is loaded and no HTML from the API is rendered. `next dev` adds `'unsafe-eval'` and `ws:`/`wss:`.

- **The CSP part of `STOREFRONT_IMAGE_HOSTS` is read at build time:** Next evaluates `headers()` during `next build` and stores the result in `.next/routes-manifest.json`. Verified: a build without the variable and a `next start` with it kept `img-src 'self' data:`; a build with it contains the host. Change the variable, rebuild. (The image optimizer and the pages read it again at start, see "Images".)
- The header code lives in `next.config.ts` itself: Next compiles only that one file for its config, and a relative import of another TypeScript file fails with `MODULE_NOT_FOUND`.

## Structure

See `docs/files/storefront.md` for one line per file. In short:

- `src/app/[locale]/` routes only compose. `layout.tsx` is the root layout (`<html lang>`, `SiteShell`); `(site)/` holds the pages that need the locale check and the loading state; `error.tsx`, `not-found.tsx` and `[...rest]` are the error states.
- `src/components/`: storefront components; dumb token-styled parts come from `@fluxkit/ui`. Client islands (`'use client'`): `cart-badge`, `account-link`, `locale-switcher`, `i18n-provider` and the three tiny route files for loading, error and not-found. The pure `*View` components next to them are what the tests render.
- `src/lib/`: logic without markup (`money`, `date`, `problem-messages`, `store-data` and `store-data.server`, `locale-check`, `locale-path`, `session-state`, `client-messages`, `navigation-categories`).
- `src/layout/` and `src/config/`: configuration (below). `src/messages/`: `uk.json`, `en.json`.

### Layout composition is configuration

- Home page: `src/layout/home.ts` lists the sections in order with props (message keys, a `limit`); `components/home-sections.tsx` has the registry (one renderer per section type). `categoryTiles` and `newProducts` get their data from `loadHomeData` (`lib/catalog-data.ts`, called by the page) and render an empty state when there is none. The registry renderers are synchronous and receive the loaded data in their context, so they stay testable with `renderToStaticMarkup`.
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

- Catalog pages: one `h1`; product titles are `h2` under the catalog `h1` and `h3` under a home section's `h2`; breadcrumbs and pagination are labelled `nav`s with `aria-current="page"`; the product card is one click target with a separately clickable brand link; the option picker is a radio group per option (arrow keys, native); quantity and buttons are labelled; a disabled add button points at the availability text with `aria-describedby`; availability is always text plus a badge, never colour alone; no quantities are shown.

NOT checked (no browser or screen reader here): a real keyboard walk, focus order after the client islands load, screen-reader output, the client-rendered error and not-found pages, reflow at 320 px.

## Bundle (step 4b check)

`pnpm build` prints no sizes in Next 16; `.next/diagnostics/route-bundle-stats.json` has them. First-load JS of `/[locale]` (the home page): **485,404 bytes uncompressed, about 146 KB gzip**. The bare `/_not-found` route is 456,219 bytes (React, Next and the router), so the app itself adds about 29 KB uncompressed. `@fluxkit/core`, `@fluxkit/config` and zod are NOT in any client chunk (all `.next/static/chunks/*.js` were searched for their code); `@fluxkit/api-client` and the `@fluxkit/ui` translator are. `client-boundary.spec.ts` fails if a `'use client'` file imports a `*.server` module, `@fluxkit/config`, `@fluxkit/core` or `next/server`, or if any storefront file imports `@fluxkit/core`. The plan's question whether to use the core validators on the client is decided when a form needs them, with a new measurement.

### Step 5 measurement

`.next/diagnostics/route-bundle-stats.json` after `next build` (no API running): first-load JS `/[locale]` (home) 502,587 bytes uncompressed (148.9 KB gzip) against 485,404 (146 KB) in step 4b, `/[locale]/catalog` and `/[locale]/c/[slug]` 500,012 (148.0 KB gzip), `/[locale]/p/[slug]` 512,061 (151.7 KB gzip), `/_not-found` unchanged at 456,219. The growth is `next/image`, the purchase island and the cart event code. `@fluxkit/core`, `@fluxkit/config` and zod are still not in any client chunk.

## Known limits and TODOs

- `TODO(fluxkit)` the locale switcher keeps path and query but not the URL fragment; the guest order page (step 7, token in the fragment) must handle that.
- `TODO(fluxkit)` the product page shows the product-level attributes only; the attributes of the selected variant (`variant.attributes`) are not shown.
- `TODO(fluxkit)` the "go to the cart" link after an add and the header cart link lead to the 404 page until step 6 builds the cart page.
- The 404 pages of the catalog routes arrive with an empty server-rendered body (the 4b finding: the client completes the page from the RSC payload). Status and `noindex` are correct; a crawler that does not run JavaScript sees no text, which is fine for a 404.
- Image dimensions are not in the API, so every image is a square crop (`object-cover`); a client with other proportions changes `StoreImage` and the card, not the data.
- `components/styles.ts` repeats the `focusRing` class of `@fluxkit/ui` (not exported there) and defines link styles because `@fluxkit/ui` has no link-styled button; an exported `focusRing` and a `ButtonLink` in the UI library would remove the duplication.
- There is no `global-error.tsx`: an error in the root layout itself (for example a missing `API_INTERNAL_URL`) shows Next's built-in error page.
