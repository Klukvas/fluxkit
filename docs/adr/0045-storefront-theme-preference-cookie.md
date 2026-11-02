# 0045. Storefront theme: a preference cookie rendered by the server

Status: proposed 2026-11-03 (design batch B, plan `docs/plans/2026-11-03-storefront-design-b.md`, decision 5; the orchestrator's task asked for a
cookie-persisted dark theme switch). **Owner and legal confirmation needed** (see "Consequences"). Supersedes in part ADR 0033 decision 11 ("The
only cookies are `fluxkit_cart`, `fluxkit_customer_session`, `fluxkit_admin_session`" and the guard against any storefront cookie): it adds one
storefront cookie. Keeps every other part of ADR 0033 decision 11 (first-party only, no analytics or advertising cookie, no consent banner, the
API's cookie guard, the legal placeholder pages).

## Context

- `packages/theme/src/tokens.css` has had light and dark values for every colour token since plan step 7 (contrast-tested), but the storefront
  rendered `<html data-theme="light">` always: the dark theme was unreachable (designer review, recommendation 5).
- A shopper's choice (light, dark, follow the device) must be known when the server renders the HTML; otherwise the page paints in one theme
  and switches after a script ran (a "flash"). `localStorage` cannot be read by the server; an inline script before the first paint would need
  a CSP nonce or a hash (the storefront has no nonces, README "Content-Security-Policy"). A cookie is sent with the page request.
- The storefront rendered every page per request already (README "Rendering"), so reading a cookie in the root layout costs no static page.

## Decision

1. **Cookie `fluxkit_theme`**, value `light`, `dark` or `system`, `Path=/`, `Max-Age` one year, `SameSite=Lax`, `Secure` when the shop is served
   over https, not `HttpOnly` (the switch writes it in the browser). Set ONLY when the shopper presses the footer's switch; never on a first visit
   (the default comes from `apps/storefront/src/config/theme.ts`). It holds no identifier and no personal data and is never sent anywhere but to
   the shop's own origin.
2. **Server-rendered theme:** the root layout reads the cookie with `cookies()` and renders `<html data-theme>` from it (an unknown value falls
   back to the configured default). `system` is decided by CSS (`@media (prefers-color-scheme: dark)` scoped to `[data-theme="system"]`), so it
   needs neither a script nor a cookie. No inline script is added.
3. **Writers:** the footer switch (`components/theme-switch.tsx`, `document.cookie`) and, without a script, `POST /theme`
   (`app/theme/route.ts`, `lib/theme-route.ts`: `Set-Cookie`, `303` back to a checked path of the storefront). Both take the whole cookie text
   from `themeCookie` (`lib/theme-mode.ts`). `source-guards.spec.ts` and `security-headers.spec.ts` allow exactly these two writers and the
   layout's one read; any other cookie access in the storefront still fails CI.
4. **Off switch:** `showToggle: false` in `config/theme.ts` hides the switch, makes `/theme` a 404 and ignores an existing cookie: the shop is
   then cookie-free on the storefront side exactly as under ADR 0033.

## Consequences

- The cookie statement (`/{locale}/legal/cookies`, `cookieTable` in `apps/storefront/src/config/legal.ts`) lists the third cookie, and
  `docs/privacy/README.md` section 5 says so. The reading as strictly necessary (a user-interface preference set at the user's explicit request,
  which the ePrivacy guidance of the Article 29 Working Party, Opinion 04/2012, treats as exempt from consent when it serves that request) is
  the template's assumption, NOT legal advice: **the owner's lawyer confirms it** together with the no-banner reading of ADR 0033 decision 11
  (privacy task O3), or the shop sets `showToggle: false`.
- The admin app is not affected: it keeps `data-theme="light"` and never sets `system` (`apps/admin/src/theme-isolation.spec.ts` checks its
  built CSS).
- A 404 rendered before the first byte (README "Rendering", the `__next_error__` document) carries no layout attributes until its payload
  renders. Measured on `next start` with the dark cookie (`/en/p/<unknown>`, `/en/<unknown>`, `/xx`): the server HTML is
  `<html id="__next_error__">`, the body is empty until the script renders the page, then `data-theme="dark"`; without a script the page
  stays empty (as before this change, README finding).
