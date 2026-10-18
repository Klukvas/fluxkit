# 0026. Storefront architecture: one origin, rendering split and the typed client

Status: accepted 2026-10-18 (owner approval of `docs/plans/2026-10-18-storefront.md`, step 1). Builds on ADR 0015 (cart and checkout, same-site storefront, no CORS), ADR 0016 (customer sessions, store CSRF header, rate limits), ADR 0023 (guest order tokens) and ADR 0024 (open-order limit, `TRUST_PROXY`). Nothing in those ADRs changes.

## Context

- The store API keeps its cookies (`fluxkit_cart`, `fluxkit_customer_session`) on `Path=/store`, requires `X-Fluxkit-CSRF: 1` and a JSON content type on every state-changing request, and sends no CORS headers.
- Per-address rate limits use `request.ip`, which is the real client only when `TRUST_PROXY` matches the deployment (ADR 0024). A Next.js rewrite (checked in the installed Next 16.4.1, `proxy-request.js`) sets only `x-forwarded-host` and passes a browser-sent `X-Forwarded-For` through, so behind a rewrite the limits are either one shared window or spoofable.
- The browser never sends the `Path=/store` cookies to page requests such as `/uk/cart`, so the Next server cannot read them.
- `pnpm build` runs in CI with no API running.
- The guest order access token is a bearer secret shown once (ADR 0023).

## Decision

1. **One origin.** The browser reaches the API as `/store/*` on the storefront origin. In development a Next.js rewrite does this. In every deployed environment an edge reverse proxy (Caddy or nginx, documented in the README, no new Compose service in v1) routes `/store/*` (and later `/admin/*`) to the API and sets `X-Forwarded-For` itself, with `TRUST_PROXY` set to the real hop count. The Next rewrite is never used in a deployed environment.
2. **Rendering split.** Public catalog pages (home, category, product, sitemap) render on the Next server at request time from API responses cached for 60 seconds, without cookies. Personalized pages (cart, checkout, account, order) render in the browser and call `/store/*` directly with `credentials: same-origin`. The Next server never handles store cookies; Server Actions and mutating Route Handlers are not used for store operations. The cookie path stays `/store` and there is no second session system.
3. **No API at build time.** `next build` never calls the API; data pages are dynamic or revalidated at runtime.
4. **Guest order token.** It travels only in the URL fragment (never sent to a server by the browser, absent from `Referer`) and in the POST body of lookup and cancel. It is not stored in `localStorage`; the confirmation page prompts the guest to save the link.
5. **Idempotency keys.** One `Idempotency-Key` per checkout request body, generated in the browser, reused for every retry of that body and replaced when the body changes.
6. **Typed client.** `@fluxkit/api-client` types are generated from `docs/api/openapi.json` with `openapi-typescript` (devDependency, types only) at build time; the runtime is a thin hand-written fetch wrapper that owns the CSRF header, the content type, the idempotency header and problem parsing. If the generator is not compatible with the pinned TypeScript 6.0.3, hand-written types plus a schema test replace it.
7. **Design and strings.** Components use tokens only (new additive tokens `success`, `warning`, `ring`), page layout is a configuration of registered sections, all strings go through i18n (AGENTS.md section 2.2); a Content-Security-Policy without per-request nonces (`script-src 'self' 'unsafe-inline'`, `frame-ancestors 'none'`) keeps cached rendering.

## Consequences

- Personalized pages show a loading state after first paint and are not indexed.
- Prices on catalog pages may be up to 60 seconds old; the cart and the order are authoritative.
- Deployment needs a reverse proxy; its example configs are part of the docs, and it also serves the admin later.
- Pages refresh on a timer until catalog change events exist (a later plan).
- Changing the cookie path, adding CORS, or building a backend-for-frontend session in Next would supersede this ADR.
- Cost: every personalized page makes client-side requests, and the storefront must handle the cart and account state in the browser.

## Alternatives considered

- Next rewrites in production: rejected (rate-limit spoofing or one shared window, see Context).
- Cookie `Path=/` so the Next server sees the session: rejected (breaking cookie contract, cookies reach every page request and `/admin`).
- Backend-for-frontend session in Next: rejected (a second session system, large and security-heavy).
