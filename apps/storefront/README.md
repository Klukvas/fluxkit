# @fluxkit/storefront

Next.js 16 (App Router, Turbopack) customer storefront. Plan: `docs/plans/2026-10-18-storefront.md`, decisions: ADR 0026, rules: `AGENTS.md` section 2.2 (theming, i18n, layout composition) and `apps/storefront/AGENTS.md` (read the Next docs in `node_modules/next/dist/docs/` before writing Next code: this version differs from older knowledge).

Status (step 6 of the plan): the cart and accounts. On top of the catalog (home sections, catalog, category and product pages, SEO metadata, JSON-LD, `sitemap.xml`, `robots.txt`) the cart page, sign-in, registration, the account overview, profile edit, change password and sign out exist, all rendered in the browser from the shared cart and account stores (see "Cart and accounts (step 6)"). The checkout page and the order pages are step 7; links to them (the cart's checkout button, the account's order history, which has no link yet) lead to the translated 404 page until then.

## Routes

| Route | Rendering | Data (all through the 60 s data cache) | Indexing |
|---|---|---|---|
| `/{locale}` | server, per request | `GET /store/products?limit=8`, `GET /store/categories`, `GET /store/config` | index, canonical, hreflang |
| `/{locale}/catalog` (`?page`, `?brand`) | server, per request | `GET /store/products?limit=24&offset=` (+ `brand`), `GET /store/config` | page 1 index; `noindex, follow` on a brand filter and on page 2 and later; canonical never has `brand` |
| `/{locale}/c/{slug}` (`?page`, `?brand`) | server, per request | categories tree (breadcrumbs, children), products with `category=` (descendants included by the API) | same rules as the catalog |
| `/{locale}/p/{slug}` | server, per request; `ProductPurchase` is a client island | `GET /store/products/{slug}`, config, categories | index, Product and BreadcrumbList JSON-LD |
| `/{locale}/cart` | shell on the server (the shop's currency digits and the image host list); the cart itself is read in the browser | `GET /store/cart` and the cart writes, `no-store`, same origin | `noindex, nofollow`, no canonical |
| `/{locale}/account/login`, `/register` (`?next`) | shell + client form | `POST /store/account/login`, `register` | `noindex, nofollow` |
| `/{locale}/account`, `/account/profile` | shell + client, behind the account gate | `GET`, `PATCH /store/account/me`, `change-password`, `logout` | `noindex, nofollow` |
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

- `ProductPurchase` adds through the shared cart store (`cart.add`, `lib/cart-store.ts`): the cart cookie has `Path=/store`, so only the browser can send it; the api-client adds `X-Fluxkit-CSRF`. Quantity 1 to 999 is checked before the request. The button is disabled while the request runs and for an `out_of_stock` variant (decision: the cart would accept such a line but the checkout refuses it; a backorder or untracked variant reports `in_stock`, so the shop's own rule decides).
- **Messages:** failures show the translated message of the problem (`errors.rule.variant_not_sellable`, `errors.rule.quantity_limit`, `errors.too_many_requests` for 429, `errors.network`, `errors.invalidResponse`, `errors.generic` for anything unknown), never the API's text. The result is announced through a `role="status"` region that is always in the page (a live region only announces changes to a region that already exists); an error is an `Alert` with `role="alert"`. An add failure is returned to the product page and NOT kept in the shared state (the cart page would otherwise show a stale "too many requests" later).
- **Cart event (`lib/cart-events.ts`, step 5, unchanged):** `fluxkit:cart-changed` on `window` with `{ itemCount }`. It is still the one signal, but the cart store now publishes it for EVERY applied answer (add, quantity, remove, clear, acknowledge, a sign-in's cart reload, the first read) and also follows it: an event from another publisher whose count differs from the store's re-reads the cart (once; the store's own events are ignored, so there is no loop).

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
- `src/components/`: storefront components; dumb token-styled parts come from `@fluxkit/ui`. Client islands (`'use client'`): `session-provider` (the cart and account stores), `cart-badge`, `account-link`, `session-notices`, `cart-page`, `login-form`, `register-form`, `account-gate`, `account-overview`, `profile-forms`, `product-purchase`, `store-image`, `locale-switcher`, `i18n-provider` and the three tiny route files for loading, error and not-found. The pure `*View` components next to them are what the tests render.
- `src/lib/`: logic without markup (`money`, `date`, `problem-messages`, `failure`, `store-data` and `store-data.server`, `locale-check`, `locale-path`, `safe-next`, `cart-store`, `account-store`, `session-stores`, `cart-model`, `cart-handlers`, `client-messages`, `navigation-categories`).
- `src/layout/` and `src/config/`: configuration (below). `src/messages/`: `uk.json`, `en.json`.

### Layout composition is configuration

- Home page: `src/layout/home.ts` lists the sections in order with props (message keys, a `limit`); `components/home-sections.tsx` has the registry (one renderer per section type). `categoryTiles` and `newProducts` get their data from `loadHomeData` (`lib/catalog-data.ts`, called by the page) and render an empty state when there is none. The registry renderers are synchronous and receive the loaded data in their context, so they stay testable with `renderToStaticMarkup`.
- Header and footer links: `src/layout/navigation.ts` (message keys and locale-less paths; `localizedHref` adds the locale and refuses anything that is not a plain path).
- Checkout settings (allowed shipping countries, default country `UA`, which address fields are shown): `src/config/checkout.ts`, consumed by step 7.

**Add a home section:** add a member to the `HomeSection` union and an entry to `homeSections` in `layout/home.ts`, and a renderer in `homeSectionRegistry` (TypeScript fails until both exist). **Add a header or footer link:** add `{ labelKey, href }` to `navigation.ts` and the message key to both JSON files.

### i18n

- Every user-facing string is a message key in `src/messages/{uk,en}.json`; components receive a translator (`createTranslator(messages, locale)` from `@fluxkit/ui`), a missing key or placeholder value throws. Server components build it from `messagesByLocale`; client components use `useI18n()`.
- **Client subset:** only keys with a prefix in `lib/client-messages.ts` (`nav.`, `locale.`, `error.`, `errors.`, `notFound.`, `loading.`, `product.`, `availability.`, `cart.`, `account.`) are serialized into the page for the browser. A client component that needs a new namespace must add its prefix there.
- **Add a message:** add the key to BOTH files. Plural forms are separate keys (`nav.cart.items.one|few|many|other` for `uk`, `one|other` for `en`, each with `{count}`), used with `t.plural(key, count)`. `messages/messages.spec.ts` fails on: a key in one file only, different `{placeholders}`, an incomplete plural group, and a string literal in the source that looks like a key but is not in the files.
- **Problems from the API** (`lib/problem-messages.ts`): only translated messages are shown, never the API's `detail` or `message`. `errors.<code>` for a problem `code` (every value of `ProblemDetailsDoc.code`; a test compares the list with `docs/api/openapi.json`), `errors.rule.<rule>` for a `rule_violation` rule, `errors.field.<code>` for an `errors[].code`, `errors.network` and `errors.invalidResponse` for the client's thrown errors, `errors.generic` for anything unknown (the unknown code is logged with `console.warn` in development only). A new API code fails the test until it gets a decision and a message.
- Money and dates: `lib/money.ts` (`formatMoney({amount, currency}, exponent, locale)`: the amount becomes a decimal string with BigInt arithmetic and `Intl.NumberFormat` formats the string; the exponent is the shop's `currencyExponent` from `GET /store/config`, falling back to Intl's digits for the currency; the storefront never adds or multiplies money) and `lib/date.ts` (`Intl.DateTimeFormat`; an invalid date throws).

## Cart and accounts (step 6)

All personalized pages follow ADR 0026: a server-rendered shell plus client components that call `/store/*` from the browser (`baseUrl ""`, same origin, `cache: "no-store"`; the cookies have `Path=/store` and never reach the Next server). They live in the `(site)` route group (locale check and loading skeleton; they never answer a 404 themselves, so the `(catalog)` rule about real status codes does not apply) and never call `notFound()` (`lib/route-locale.ts` narrows the locale type instead).

### One store, one read (how the cart context and the header badge share the fetch)

`components/session-provider.tsx` sits in `SiteShell`, inside the locale layout, and creates two plain stores (no library; `useSyncExternalStore` hooks `useCart()` and `useAccount()`): `lib/cart-store.ts` and `lib/account-store.ts`, wired by `lib/session-stores.ts`. **Decision:** the header badge and the account link no longer fetch by themselves; they read the stores. So one page load makes ONE `GET /store/cart` and ONE `GET /store/account/me`, whichever islands exist, and the cart page, the badge and the add-to-cart button always show the same cart. `start()` is idempotent (React strict mode mounts twice and still reads once). When the cart page is opened by client-side navigation (the state is already known and may be old) it reads again once; on a direct load the first read is still in flight and no second one is made. Guards: `client-boundary.spec.ts` (the only client file that creates a store client is the provider; the header islands call nothing) and the store tests (`start` twice is one request).

### Cart store rules (each has a test; `lib/cart-store.spec.ts`)

- Server values only. No optimistic update of a quantity or an amount: the cart changes when an answer arrives (mutation checked: an optimistic quantity fails three tests). Busy lines are disabled instead.
- Every answer that holds a cart replaces the state and publishes `fluxkit:cart-changed`: a `200`, and the `cart` inside a `409 cart_changed` (the reason is still shown, in `failure`).
- Requests are numbered when they START; an answer replaces the state only when its number is higher than the last applied one. A slow older answer (a write whose reply arrives after a newer write's, or a read that started before a write) is dropped and not published; the failure of an older request is not shown either. Tested both with out-of-order and in-order answers.
- A failed write (`429` with its `Retry-After` wait, network, `5xx`, a refused rule) keeps the previous cart and shows a translated message (`failureText`: the message, plus "Try again in N seconds" for a 429). A failed FIRST read leaves `status: "error"` with a retry. An unexpected exception (a bug) releases the busy mark and is rethrown.
- `clear()` is `DELETE /store/cart` and then a read: the empty cart (with its currency) is the server's, the storefront never builds money. There is no "empty the cart" button yet (decision: an accidental click would drop up to 100 lines, and a confirmation step is more UI than step 6 needs); the store method exists and is tested.
- Quantities 1 to 999 are checked before a request (`errors.field.invalid_quantity`).

### Cart page (`/{locale}/cart`, `components/cart-page.tsx`)

- Lines: image (`StoreImage`, the host allow-list comes from the server shell as a prop; any other host shows the placeholder), title linked to the product, option text from the API's `optionValues`, SKU, unit price, line total, quantity form, remove. The quantity is a draft until the shopper presses "Update" (one request per submit, not one per keystroke); a new server quantity resets the draft.
- Notices exactly as the plan says: `price_changed` "was X, now Y" (a price seen in ANOTHER currency is formatted with that currency's own digits, not the shop's), `unavailable` (no price, no quantity box, remove), `out_of_stock` (badge plus a hint that the order may be refused), `line_total_out_of_range` ("lower the quantity"; the quantity box stays because lowering it is the repair).
- Cart-level banner "prices changed" with OK = `POST /store/cart/acknowledge` (disabled while a whole-cart write runs).
- Summary: item count, subtotal and total through `formatMoney` from the API values; nothing is added or multiplied (mutation checked: a subtotal summed from lines fails two tests). `lineTotal` is shown as the API gives it.
- Checkout: a link to `/{locale}/checkout` while `purchasable`; otherwise a disabled button with a visible reason (`aria-describedby`). **The checkout page is step 7: the link leads to the translated 404 until then.**
- States: skeleton with `aria-busy` (loading), an alert with retry (first read failed), an `EmptyState` with a link to the catalog, an alert with dismiss for a failed write. An always-mounted `role="status" aria-live="polite"` region says what the last action did ("Cart updated. Items: 2. Total: ...").

### Session handling (`lib/account-store.ts`)

- The header link shows "Sign in" for a guest (`401` from `me` is the normal answer and logs nothing), the customer's FIRST NAME for a signed-in shopper (`nav.account.named`, rendered as text: a test renders a hostile name and finds no markup; the link truncates a long name), and the neutral account link when the session could not be read.
- A sign-in or registration sets the session, keeps `cartNotices` and asks the cart to reload (`onSessionChanged`), so the badge shows the merged cart. A sign-out does the same (the account's cart is no longer visible) and drops the notices; a `401` from logout means the session was already gone and counts as signed out. A late session read never overwrites a sign-in that finished after it started (numbered like the cart).
- **Identical failure.** A `401` on login is ONE message (`account.login.invalid`) with no field marked, whatever the API body says (the API answers the same for an unknown email, a wrong password, a locked and an inactive account; the message only says that repeated failures pause sign-in "for a while", no number). A `429` shows `errors.too_many_requests` plus the wait from `Retry-After` (whole seconds only, capped at a day; anything else shows no wait). A taken email on registration is a field error worded "sign in instead" (the API accepts that trade-off, ADR 0016).
- **Double submit:** the button is disabled while pending, a ref drops a second submit that arrives before React rendered the disabled button, and the store joins a second call of the same action to the request in flight (one request; tested).
- **No secrets anywhere:** a password lives in the request body only: never in a URL, the stores' state, a log, `localStorage` or `sessionStorage` (`source-guards.spec.ts` fails on browser storage or `document.cookie` in the cart and account files and on a `console.*` that mentions a password, values or a body; a store test serializes the state after a failed login and looks for the password). A password field is emptied after a refused sign-in; both password fields are emptied after a password change.
- **Account gate** (`components/account-gate.tsx`): `/account` and `/account/profile` show a skeleton while the session is read, the page for a signed-in customer, and for a guest a link to sign in plus a `router.replace` to the login page with the page as `next`. Any protected call that answers `401` (the session ended while the page was open) makes the store a guest, which triggers the same redirect. Every state has one `h1`, also in the server HTML. When the session cannot be read there is a retry.
- **Sign-out** goes to the home page.

### The safe `next` rule (`lib/safe-next.ts`)

`/account/login?next=` and `/account/register?next=` say where to go after signing in. It comes from the URL, so `safeNextPath(value, locale)` accepts only a path inside the CURRENT locale's storefront: it must start with `/{locale}/`, contain no backslash, no `//`, no `#`, no control character or space, no `..` segment, in the text AND in any percent-decoded form of it (up to three decodings; a malformed escape is refused), must parse as a same-origin path, and must not be the login or register page itself (a loop). Anything else (including a missing value or a repeated parameter) falls back to `/{locale}/account`. Tested with `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:...` in mixed case, `data:`, encoded and double-encoded slashes and backslashes, encoded tabs, dot segments (plain and encoded), NUL, a fragment, another locale, a prefix that only looks like the locale, and a 2000 character value. `authHref`/`loginHref` build the links and keep `next` only when it passes. The forms navigate with `router.replace(safeNextPath(...))`; `source-guards.spec.ts` fails on any `router.push/replace` argument that is not built by `safeNextPath`, `localizedHref` or the gate's own login link, and on `window.location` assignments.

### `cartNotices` (merge notices) once

A sign-in or registration returns `cartNotices` (`quantity_capped`, `lines_dropped`). The account store keeps them in memory; `SessionNotices` (the only place that renders them, at the top of `<main>`, guarded by a source test) shows them as a dismissible polite message on whatever page the shopper lands on; dismissing clears them, the next sign-in replaces them, a reload loses them. Verified at the API with a real merge: 600 + 600 gives `quantity_capped` and a line of 999.

### Forms and accessibility

Labelled inputs (`Field`), `aria-invalid`, hint and error linked with `aria-describedby`, `required`, `autocomplete` tokens (`email`, `current-password`, `new-password`, `given-name`, `family-name`, `tel`; tested per input, a mutation removing one fails a test), `noValidate` forms with the server as the judge (blank required fields are reported at once, without a request). After a failed submit focus goes to the first invalid field in PAGE order, else to the error summary (`lib/failure.ts` `focusAfterFailure`, tested with a fake document); the summary is one `role="alert"` box that lists each field error as a link to its field. The password rules (12 to 128 characters, not the email) are a hint; the API's answer shows through `errors.field.*`.

### What is NOT tested (no browser here)

Everything that needs a DOM and events: typing, the +/- and Update buttons of a line, focus actually moving after a failed submit, the redirect after sign-in, the account gate's `router.replace`, hydration of the islands, strict-mode double effects, the live region being read by a screen reader. What IS tested: all state logic with injected clients (including staged out-of-order responses), the markup of every view in every state with sentinel and real translators, the handlers a view calls (by reading the element tree), and a real run of the API flows through a same-origin proxy (the plan's "Manual run" with curl, evidence in the step 6 report).

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

### Step 6 measurement

`.next/diagnostics/route-bundle-stats.json` after `next build` (no API running), first-load JS uncompressed and gzip: `/[locale]` 512,433 (151.6 KB) against 502,587 (148.9 KB) in step 5, `/[locale]/catalog` and `/c/[slug]` 510,432 (150.9 KB) against 500,012, `/[locale]/p/[slug]` 519,343 (153.6 KB) against 512,061, `/[locale]/cart` 523,252 (154.5 KB), `/account` 501,917 (147.8 KB), `/account/login` 502,655 (148.3 KB), `/account/register` 505,299 (148.8 KB), `/account/profile` 506,450 (149.1 KB), `/_not-found` unchanged at 456,219. The growth of 7 to 10 KB on the catalog pages is the two stores and the provider, which now live in the shared layout chunk (the badge used to carry its own loader); the cart page adds about 11 KB over the home page. `@fluxkit/core`, `@fluxkit/config` and zod are still in no client chunk (all `.next/static/chunks/*.js` searched).

## Known limits and TODOs

- `TODO(fluxkit)` the locale switcher keeps path and query but not the URL fragment; the guest order page (step 7, token in the fragment) must handle that.
- `TODO(fluxkit)` the product page shows the product-level attributes only; the attributes of the selected variant (`variant.attributes`) are not shown.
- `TODO(fluxkit)` the cart's checkout button leads to `/{locale}/checkout`, which is the translated 404 until step 7. The account overview has no link to the order history (`/account/orders`, step 7) for the same reason.
- `TODO(fluxkit)` no "empty the cart" button (the store's `clear()` is built and tested, the UI is not).
- `TODO(fluxkit)` the cart store reads the cart once per page load and when the cart page is opened by navigation; a cart changed in another tab shows up at the next write or navigation (no polling, no `storage` or `focus` listener).
- The 404 pages of the catalog routes arrive with an empty server-rendered body (the 4b finding: the client completes the page from the RSC payload). Status and `noindex` are correct; a crawler that does not run JavaScript sees no text, which is fine for a 404.
- Image dimensions are not in the API, so every image is a square crop (`object-cover`); a client with other proportions changes `StoreImage` and the card, not the data.
- `components/styles.ts` repeats the `focusRing` class of `@fluxkit/ui` (not exported there) and defines link styles because `@fluxkit/ui` has no link-styled button; an exported `focusRing` and a `ButtonLink` in the UI library would remove the duplication.
- There is no `global-error.tsx`: an error in the root layout itself (for example a missing `API_INTERNAL_URL`) shows Next's built-in error page.
