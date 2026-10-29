# 0037. The storefront forwards the client address only when the operator switches it on

Status: accepted 2026-10-29 (search UI review F1 and F2, `docs/plans/2026-10-29-search-ui-review.md`). Refines ADR 0024 ("Trusted proxy hops": the Next server becomes an optional hop on one path) and ADR 0036 decision 3 (the `search` window is reached through the results page too); changes nothing else in them.

## Context

- The API counts its `search` window (60 a minute) per client address (`request.ip`, `TRUST_PROXY` hops, ADR 0024). The results page `/{locale}/search` reads `GET /store/search` from the Next server, so without help every shopper counts as the Next server's one address.
- Search plan step 10a made the Next server pass the page request's `X-Forwarded-For` (checked: at most 10 IP addresses) on to the API, always. Next fills the header only when it is absent, so a client that reaches `next start` directly (a misbound port, an internal network) chose its own key: it rotates addresses to dodge the window, or uses up a victim address's window (review F1, reproduced against the built API and storefront).
- The nginx edge REPLACED the header for the storefront location (`$remote_addr`) while the CDN runbook (`TRUST_PROXY=2`) switched only the API snippet to append, so behind a CDN every shopper of a CDN node shared one window on the results page (review F2).

## Decision

1. **Off by default.** The storefront passes no client header on unless `STOREFRONT_FORWARD_CLIENT_ADDRESS=true` (`loadStorefrontEnv` `forwardClientAddress`; exactly `true` or `false`, blank is unset, anything else stops the start). Off, the request headers are not even read and every page read counts as the Next server (the shared window is the visible, safe failure).
2. **On only behind the edge.** The setting is for a deployment where the storefront is reachable through the edge proxy alone, and that edge sets or replaces `X-Forwarded-For` on page requests exactly like on `/store/*`. With it on, the Next server is one more hop in the chain like the edge is, and the same `TRUST_PROXY` gives the shopper on both paths. The production Compose example sets it (`infra/production.env.example`: `true`; only the edge publishes ports); the development set-up leaves it off.
3. **The value is still checked** (`forwardableAddresses`: a well-formed chain of at most 10 IP addresses, else nothing is passed on).
4. **One header rule per edge.** The nginx edge sets `Host`, `X-Forwarded-For` and `X-Forwarded-Proto` in one snippet (`infra/proxy/nginx/snippets/forwarded-headers.conf`) that the API locations and the storefront location both include, so the CDN switch (append and `TRUST_PROXY=2`) is one edit that covers both paths. Caddy's `reverse_proxy` already treats both alike (its `trusted_proxies` is a server option). A static guard (`apps/api/src/payments/webhook/edge-proxy-config.spec.ts`) fails when a location sets the header itself or stops including the snippet.

## Consequences

- An existing deployment that upgrades without the variable loses the per-shopper search window of the results page (all page searches share the Next server's window) until the operator sets it; `CHANGELOG.md` says so. The browser's own `/store/*` calls are unaffected.
- `docs/deployment.md`, `README.md` ("Deployment notes") and `apps/storefront/README.md` state the rule: with the setting on, the storefront, like the API, must be reachable only through the edge.
- New optional configuration (`docs/contracts/config.md`, `.env.example`); no API, schema or dependency change.
- The storefront e2e suite runs a second `next start` with the setting off and shows the shared window; the main one runs with it on and shows per-shopper keying.
