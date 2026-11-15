# Sign-in modal — presentation plan

- Status: implemented. Branch: `feature/sign-in-modal`; local verification below, real-service Chromium and independent QA pending.
- Scope: storefront presentation and navigation wiring; authentication remains unchanged.
- Decision: [round 4, item 10](2026-11-13-storefront-ui-round-4.md) keeps `/{locale}/account/login` canonical and adds a native-dialog intercepting route.
- Existing evidence: [storefront README](../../apps/storefront/README.md), [ADR 0048](../adr/0048-first-html-budget-and-loading-boundaries.md), the route tree, forms, guards and requested browser specs; installed Next 16.4.3 docs `apps/storefront/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{parallel-routes,intercepting-routes}.md`.
- Paths below are relative to `apps/storefront/` unless prefixed with `packages/` or `docs/`.

## Existing behaviour and boundaries

- `[locale]/layout.tsx` renders `SiteShell`, the header and the shared session/cart providers. `(site)` checks storefront locales; `(catalog)`, `(pages)` and `(feature-blog)` re-export that layout. `[...rest]` has a page, no layout, and calls `notFound()`.
- The canonical login page passes a string `next` and `getEmailDelivery()` to `LoginForm`, with private metadata. The form owns validation, errors, `store.login` and `router.replace(safeNextPath(next, locale))`.
- `safeNextPath` defaults to `/{locale}/account`; it rejects login/register, fragments, off-locale paths and unsafe values. It also rejects bare `/{locale}` (no trailing slash). It will remain unchanged.
- `guestLinks` and `sessionLinks.signIn` already target `/account/login`. `AccountLink` renders Next links, whose DOM is an ordinary anchor; its initial loading state currently has no sign-in link.
- `packages/ui/src/dialog.tsx` uses `showModal()`, ignores backdrop clicks and renders its own `h2`; `dialog-focus.ts` handles cleanup/focus and stale native close events. It does not lock document scrolling. Its helpers are not exported by the package entry.
- No-JS login currently POSTs to the page itself, returns the form and keeps credentials out of URLs; it does **not** authenticate. The existing behaviour, including delayed-hydration submission, will remain intact.

## Routes and ownership

| File | Planned responsibility |
| --- | --- |
| `src/app/[locale]/@modal/default.tsx` | Will return `null` for an unrecoverable slot on hard navigation; will not fetch or render a dialog. |
| `src/app/[locale]/@modal/page.tsx` | Will return `null` at the locale root; a non-optional catch-all does not cover this path. |
| `src/app/[locale]/@modal/[...catchAll]/page.tsx` | Will return `null` on other destinations, including account, register, forgot, catalog and blog; will clear the retained slot on soft navigation. `default.tsx` alone cannot do this. |
| `src/app/[locale]/@modal/(.)account/login/page.tsx` | Will validate the locale, call `ensureStorefrontLocales()` (it is outside `(site)`), read the same email-delivery flag, normalize only the string shape of `next`, and render the existing `LoginForm` inside `SignInModal`. Will use the same `privateMetadata` title/noindex policy. |
| `src/app/[locale]/layout.tsx` | Will accept `modal: ReactNode` and pass it to `SiteShell`; the slot will sit beside this layout, outside every route group. |
| `src/components/site-shell.tsx` | Will accept an optional internal `modal` prop and render it beside `main`, under the existing i18n/session/cart providers and a small navigation coordinator. Will retain one header, main, footer and `SessionNotices`. |
| `src/components/sign-in-modal.tsx` (new) | Will own the native dialog, heading association, close controls, focus and scroll cleanup; will render the existing form as children. |
| `src/components/sign-in-navigation.tsx` (new) | Will coordinate slot activity and the latest login-link opener/origin for focus return in memory. Will not store credentials, session state or new URL parameters. |
| `src/components/account-link.tsx` | Will preserve the sign-in href, provide the account-summary focus target and a translated plain-anchor fallback in `noscript` for the current loading branch. |
| `src/components/account-gate.tsx` | Will retain `router.replace(loginHref(...))`, suppress further redirects while the sign-in slot is active. Will capture the protected target before interception changes the visible pathname. |
| `src/components/route-focus.tsx`, `src/lib/navigation-focus.ts` | Will coordinate modal entry/return with normal heading focus, consuming pathname changes without focusing the inert background. |
| `src/app/globals.css`, `src/messages/{uk,en}/account.json` | Will supply scoped token-based dialog/scroll rules and a close label if an existing translated label is unsuitable. |

- The canonical login page, `login-form.tsx`, `register-form.tsx`, `safe-next.ts`, stores, session provider and all API code will remain unchanged. The intercepted route will reuse them, not copy the form or authenticate on the server.
- The implementation will not add a root `app/layout.tsx`, a second provider, a route `loading.tsx`, or a boundary around the shell, header search or ordinary page children.
- Hard-navigation visible page content will remain inline under ADR 0048. Next slot metadata and the explicit no-JS header fallback may change HTML bytes; byte identity is not claimed. `first-html` assertions will remain strict for all 24 locale/page combinations.
- Existing canonical children routes, including `[...rest]`, resolve hard visits; no null `[locale]/default.tsx` will be added to hide missing children/404s. The build and direct-URL tests will verify this on installed Next.
- `src/route-structure.spec.ts` will add slot-location, null-fallback, intercepted private-metadata and no-loading checks; its canonical first-HTML list will remain unchanged. The intercepted view is not a new public URL.
- `src/features/slice-rules.ts` currently skips only route groups when finding URL segments, so adding the slot would incorrectly count `@modal`. `coreFirstSegments` will exclude parallel branches from canonical URL collection; `slice-rules.spec.ts` will prove `account` remains reserved and `@modal` is not a URL. Slice-local `@`/interception bans and gating rules will remain strict.

## Navigation rule

- Recommendation: **every client navigation to login will show the modal**, including automatic replacement. There will be no header-only interception flag or alternate login URL.
- The coordinator will observe ordinary same-tab login anchor activations before navigation, record only the latest origin and opener for focus return. It will not prevent the link's native/default behaviour. Modified clicks/new tabs will retain normal anchor semantics.
- It will read the actual selected `modal` segments, not infer open state solely from the pathname (the same URL also serves the full page). No entry classification, traversal flags or history records will be kept; Next/browser history owns Back/Forward. It will not overwrite Next's history state.

| Entry or exit | Planned behaviour |
| --- | --- |
| Header “Sign in” from any route group | Will open over the current page with a normal push, using the existing href without `next`. |
| AccountGate on a protected page, including session expiry | Will open through the existing replace, preserve the protected path/query as `next`, and show the guest gate behind the inert dialog. The active-slot guard will prevent a second redirect to login-with-login-as-next. |
| Checkout “Sign in” with `?next=` | Will open over checkout; the unchanged form will return to the existing safe checkout target after success. |
| Register, forgot, reset and verify pages' login links | Will also open the modal; existing link builders and `next` propagation will stay as they are. Fragments will never be copied into login URLs. |
| Modal “Register” / “Forgot password?” | Will navigate to the full destination page and the null slot will unmount the dialog. Register will keep the form's existing safe `next`; forgot will retain its existing flag-dependent link behaviour. |
| Header activation while already on the canonical login page | Will remain on the full-page form; the header link will use a plain anchor there, avoiding two login forms with identical field IDs. |
| Typed URL, external link, new tab, reload | Will render the canonical full page, including a deep link with `?next=`; no dialog will open on hydration. |
| JavaScript disabled | Will follow the header's plain-anchor fallback to the full page; the unchanged native POST will safely return it. |
| Browser Back / Forward | Will close / reopen through Next history without entry/traversal bookkeeping. The latest login-link origin/opener remains available for focus return. Password persistence across unmount is not promised. |

## Success and dismissal

- Recommendation for this presentation-only change: the header will **not** add an implicit return target. Successful header sign-in will continue to land on `/{locale}/account`; explicit safe `next` links will land on their target. This preserves registration too: its link currently carries the same `next`.
- Keeping the shopper on the originating page is possible without changing login logic: the header could build `loginHref(locale, currentPath(pathname, search))` before opening. It is not recommended in this change because it also changes the registration destination and needs deliberate handling of home, auth pages and sensitive query/fragment contexts. No `safeNextPath` relaxation will be proposed.
- `store.login` already updates the shared account store and triggers cart refresh; the header and cart badge will update through the same provider. No forced reload, router refresh, new session fetch or cookie access will be added.
- The existing success `router.replace` will navigate to a null modal route and unmount the dialog. The wrapper will not dismiss merely because session status becomes signed in: that could race the form's replacement or hide `AlreadySignedInView`.
- Escape and a translated `type="button"` close control will dismiss. Backdrop clicks will do nothing, matching UI Dialog. Repeated cancel/close events will cause at most one navigation; stale cleanup close events will be ignored.
- At dismissal, `window.navigation?.canGoBack === true` will call `router.back()`; false or an unavailable Navigation API will call `router.replace(localizedHref(locale, "/"))`. This replaces the push/replace/unknown close matrix. `next` remains only a post-login destination.
- A gate replacement therefore closes to the page before the protected page when that predecessor is on this site, else home. A direct protected visit without a same-origin predecessor closes to home. The replaced protected entry cannot be recovered.
- Browser Back after gate replacement will retain normal browser-history behaviour; it cannot recover the replaced protected entry. Forward may restore login. Tests will distinguish this from the pushed-header case.

## Dialog, focus and responsive layout

- `SignInModal` will use a storefront-local native `<dialog>` rather than change the public UI Dialog API or nest another title above the existing `h1`. It will follow the inspected Dialog/native-close lifecycle; no deep import of unexported UI helpers will be added.
- Before `showModal()`, the wrapper will assign its instance-generated ID to its contained existing `h1` and set `aria-labelledby` to it. It will rebind after a session-status render replaces that heading with `AlreadySignedInView`; form markup/source will remain untouched.
- Initial focus will go to that `h1` with `tabIndex=-1` (both form and signed-in view); this avoids opening the phone keyboard immediately. Tab will reach the fields and the close control; the native modal will make the background inert and trap focus.
- The opener captured from the header login link will be its enclosing account `<summary>`, not the link hidden when `HeaderDisclosure` closes. Other login links will restore their connected opener only when the resulting pathname plus search equals the latest activation's origin; a missing opener will fall back to that page's heading/main. Opener focusability and Tab order will not be changed.
- `RouteFocus` will skip background focus on entry and consume the pathname. Every post-close focus, whether a matching connected opener or the normal heading/main fallback, runs in an animation frame after dialog teardown: native `dialog.close()` restoration must finish first. This covers browser Back, successful navigation and the close controls.
- The dialog will use a centred card at phone and desktop widths: existing `max-w-md`, spacing, `rounded-overlay`, border, background/foreground, shadow and scrim tokens. Scoped CSS will constrain width/height to the viewport minus token spacing, with internal vertical scrolling; no new tokens or raw design values will be introduced.
- A scoped document rule while this sign-in dialog is open will lock background scrolling and release on close/unmount; existing scroll styles will not be overwritten. The card will remain usable at 320/360/390 px and with a short viewport/keyboard. No entrance animation is needed.
- Already signed in: the unchanged `AlreadySignedInView` and its account link will appear; the dialog will remain labelled and closable. Its account link will clear the slot.
- Failed sign-in: the unchanged form will focus the one error summary inside the dialog, clear only the password and preserve the email; initial-focus code will not rerun on validation/error renders and steal focus.

## Features and contracts

- The modal is core storefront presentation, not an optional feature and not one of `config/slots.tsx`'s public extension slots. No feature flag will be added.
- Feature slices will do nothing: the shared locale shell owns the slot. Blog navigation and enabled-feature gates will remain unchanged; no core component will import `(feature-blog)`.
- Removing the blog slice/package will not remove or break `@modal`. With the blog off, its URLs will still answer real 404s; the modal catch-all will not turn unknown children into successful pages.
- `docs/contracts/` will need **no change**: canonical URLs, API shapes, cookies, theme tokens, feature boundaries and extension-point signatures will stay the same. Fork-owned header/footer/slot config files will not be edited.

## Verification for the later implementation

| Layer / files | Required evidence |
| --- | --- |
| Vitest: new `src/components/sign-in-navigation.spec.tsx`, `src/components/sign-in-modal.spec.tsx`, `src/components/account-gate.spec.tsx`; existing `src/components/{account,shell}.spec.tsx`, `src/lib/navigation-focus.spec.ts` | Will cover Navigation API close decisions (true → Back, false/undefined → home), selected-slot segments, exact origin/opener matching, heading rebinding, gate re-entry prevention and unchanged hrefs. Chromium covers double-close/native events, teardown and keyboard focus. RTL interaction coverage will require the tooling decision in Red zone. |
| Existing `route-structure.spec.ts`, `features/slice-rules.spec.ts`, `source-guards.spec.ts`, `safe-next.spec.ts`, form/shell specs | Will retain privacy, native-POST, safe destination, shell and feature-isolation checks; new slot checks will not weaken existing guards. |
| New `e2e/tests/sign-in-modal.e2e.ts` | Will open from the header on home, product, catalog and a shop page; assert background preservation, labelled dialog, Escape/button close, summary focus, inert background, Tab/Shift+Tab containment, ignored backdrop, Back/Forward, successful login/header update, failed login and already-signed-in history reopening. |
| Direct/progressive enhancement | Will assert `/uk/account/login` and `/en/account/login?next=...` are full pages, including reload of an open modal; will retain unsafe/repeated-next coverage, no-JS native POST and delayed scripts. Will test the no-JS header anchor separately. |
| Navigation exits | Will test checkout return, register/forgot exits, login links from all email pages, gate replacement from `/account/orders?page=3`, no re-entry loop, gate close to its same-origin predecessor or home and a null slot after success/other navigation. |
| Mobile/a11y | Will use Chromium at 320/360/390 and desktop widths, both locales and light/dark: no horizontal overflow, reachable close/submit in a short viewport, body scroll locked/restored. Like `ui-polish` and `navigation-focus`, will assert roles, accessible names, ARIA references and actual focus/keyboard behaviour; no axe dependency is assumed. |
| Features / 404 | Will extend `e2e/tests/blog.e2e.ts` to open/close from a published blog page; will retain `blog-off`/`not-found` assertions and feature-matrix on/off/deleted checks (deleted only in its disposable CI setup). |

- `customer-account.e2e.ts` clicks header Sign in before Register: it will assert the dialog, scope the form/link locator to it, then assert full-page registration and no remaining dialog; its `/account` success expectation will stay.
- `account-email.e2e.ts` clicks “Go to sign in” after reset: it will assert and scope to the dialog, retaining old-password rejection and new-password success. `account-gate.e2e.ts` will retain exact query preservation and add the replacement/close regression.
- `failed-sign-in.e2e.ts` uses `page.goto` and will remain a full-page regression; the new modal spec will exercise the same failure assertions inside the dialog. Header-menu checks in `ui-polish` will remain menu tests, not be converted into modal-only coverage.
- `navigation-focus.e2e.ts` will keep ordinary catalog heading focus and add modal entry/return competition coverage. `first-html.e2e.ts` and `pre-hydration-forms.e2e.ts` will retain their current routes and strict assertions; raw direct-login HTML will additionally contain no open dialog.
- The developer will run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm check:boundaries`, `pnpm check:env`, `pnpm build`, `pnpm --filter @fluxkit/storefront test`, `pnpm check:docs`, then targeted storefront `test:e2e` specs and the full storefront suite against the documented disposable services. The blog run will use `E2E_FEATURES=blog` separately.
- The visual harness will compare direct full-page login and existing pages; intentional no-JS header differences will be narrowly declared if observed. New modal captures will supplement, not replace, keyboard assertions. Failures/unavailable checks will be reported explicitly.

## Documentation in the implementation change

- `apps/storefront/README.md` will describe the navigation matrix, first-HTML guarantees, gate-close behaviour, default account destination and actual no-JS limitation.
- `docs/files/storefront.md` will map the slot, wrapper and coordinator; `apps/storefront/e2e/README.md` will list the new scenarios and tooling limitations.
- `CHANGELOG.md` will record the presentation change; `docs/HANDOFF.md` will record actual implementation/verification status and update its date.

## Implementation notes (2026-11-15)

- The null catch-all is `src/app/[locale]/@modal/[...rest]/page.tsx`: installed Next 16.4.3 rejects the planned `[...catchAll]` as an ambiguous pattern alongside the existing canonical `[...rest]`. Matching the existing parameter name preserves the same URL coverage without changing canonical routes or adding a children fallback.
- The first-segment walk in `config/shop-pages.spec.ts` skips parallel slots, which have no URL segment. The orchestrator explicitly permits config tests; fork-owned config value files remain unchanged.
- Source guards remain unchanged: gate navigation calls `loginHref` directly, canonical-login header navigation uses its plain anchor, and dialog CSS lives in the existing component layer. The header-search navigation mock now includes the selected-slot hook.
- Default root build: 17/18 tasks succeed; storefront reaches compile then Turbopack fails because sandboxing forbids binding its PostCSS worker port (`Operation not permitted`). The default build must be repeated outside this sandbox. `pnpm --filter @fluxkit/storefront build --webpack` passes (compile, TypeScript, 47 static pages and traces).
- No RTL/jsdom or no-JS header fallback, as ruled below. Behavioural scenarios use Chromium; they are not run here because the real services are unavailable. The orchestrator owns independent QA, browser/first-HTML/feature-matrix and visual acceptance; no commit, push, deploy or next task is performed.

## Fix round 1 (2026-11-15)

- Independent QA requested changes; the orchestrator's initial real-service Chromium run reports 249 passed and 8 failed. Build/e2e reruns and fresh review remain with the orchestrator for this fix round; the developer leaves the fixes uncommitted.
- The coordinator reads `useSelectedLayoutSegments("modal")`: installed Next 16.4.3 returns `["(.)account", "login"]`, while its singular hook returns the last segment for a named slot. The pure helper also accepts Next's `null` result without a layout-router context (standalone static renders).
- Next exposes no history-entry index. Traversal metadata is reused only for a single recorded entry at that URL; duplicate/unknown entries and traversals after the bounded record fills dismiss to home. The gate → Register → Sign in → Back twice regression fails before the fix (`back`, expected `home`) and passes after it.
- Heading rebinding preserves existing focus inside the dialog, including the failure summary, while still focusing an initial or replacement heading after focus is lost. Pure callback regressions cover both paths.
- Test corrections: Ukrainian dialog name `Вхід` (the heading), English forgot link `Forgot your password?`, an unscoped descendant locator inside the relative summary filter, and native Tab behaviour matching `apps/admin/e2e/tests/keyboard.e2e.ts` for the shared Dialog (browser controls allowed, background page controls forbidden). No check is disabled.
- Node 22 verification: storefront `typecheck`, root `lint`, `format`, `format:check`, `check:boundaries` (2,901 modules, zero violations), storefront `test`: default 2,534 passed; brand fork 2,435 passed; home fork 2,439 passed and 13 existing template-only skips. The first full unit run exposed the null-context edge above; the corrected complete rerun passes. No build or e2e is run in this round, per the current request.

## Fix round 2 (2026-11-15)

- The orchestrator replaces history classification with a live Navigation API `canGoBack` decision. The dialog retains its per-instance repeated-close/stale-native-event guard. No change to auth, forms, session, API, cookies, contracts, header markup, fork-owned values or dependencies.
- The click observer retains only the latest login-link origin/opener; Back/Forward needs no coordinator updates. AccountGate retains its modal-active guard and original `next`, without preparing a replacement entry.
- RouteFocus defers every post-close focus until an animation frame after native-dialog teardown. Connected matching openers retain native focusability; only fallback heading/main receives `tabindex=-1` through the existing navigation-focus helper.
- Unit regressions cover close decisions, selected segments and exact origin/search/connection matching. Chromium scenarios retain product/header and forgot-page return, add summary Shift+Tab/Tab reachability and query-only Back → open → close → Forward → close. The gate's direct-visit test has no same-origin predecessor and expects home plus heading focus; a separate same-origin predecessor test expects Back to that page.
- Node 22 local checks pass: storefront typecheck; root lint, format + format:check; check:boundaries (2,902 modules, zero violations); storefront test: default 2,533 passed, brand fork 2,434 passed, home fork 2,438 passed with 13 existing template-only skips. `git diff --check` passes. No build or e2e in this round, per the current request; the orchestrator owns those runs and fresh independent QA.

## Red zone

- No server sign-in logic, session/cookie behaviour, API response or public-contract change is required or planned. Any discovered need will stop implementation and go to the owner, rather than be folded into this plan.
- RTL and a DOM test environment are absent from the current manifests (Vitest uses pure logic/static markup). The requested Vitest + RTL interaction tests therefore need dependency approval first: the implementer will present exact pinned packages, licenses, size and alternatives. This plan does not authorize installation. Until decided, Vitest pure/markup plus real Chromium covers the existing stack, but will not be reported as RTL coverage.
- Actual authentication without JavaScript would require a server flow and is outside this decision; it will not be implemented under “preserve native POST”.

## Risks and open questions

| Risk / question | Recommendation |
| --- | --- |
| More navigation coordination than a local open boolean | Will keep one internal coordinator with no persistence or global auth state; routing remains the source of truth. |
| Gate replacement loses the protected history entry | Will use the browser's live `canGoBack` decision: same-origin predecessor before the protected page, else home; will not change the gate to push. |
| Should header login stay on the shopper's page? | Will retain the existing account destination for this presentation-only change; explicit `next` already supports contextual returns. |
| Native dialog helper duplication / heading replacement | Will keep the wrapper local and small, test native close semantics and label resolution, and leave the shared UI API untouched. |
| Background form IDs or focus collisions | Will avoid interception from the canonical login page, scope browser locators to the dialog and test register/reset backgrounds and `AlreadySignedInView`. |
| Parallel-route matching, cached history or streaming changes | Will treat installed-Next build, first-HTML, real 404 and Back/Forward tests as acceptance gates, not infer success from unit tests. |
| RTL request versus no new approved tooling | Will resolve dependency approval before claiming the requested unit-interaction coverage; no silent dependency or test substitution. |
| Mobile Safari/top-layer scrolling | Chromium will be the automated baseline; iOS Safari keyboard/scroll behaviour will remain explicitly unverified until a real-device pass. |

## Orchestrator decisions (2026-11-15, before implementation)

- No `noscript` sign-in link in the header: the header markup (and its frozen snapshots, `header-footer-defaults`) stays as it is.
  "Sign-in without JavaScript" means what exists: the header link needs the account island; a direct visit to `/{locale}/account/login`
  is the full page and its native POST keeps working (`pre-hydration-forms`). No dialog without JavaScript.
- No new dependency (RTL, jsdom): red zone. Unit coverage uses what the storefront already has (pure functions and static markup in
  Vitest); behaviour (focus, Escape, history) is covered by Playwright in Chromium.
- After a successful sign-in the destination stays as the form decides today (`safeNextPath`: `/{locale}/account` without `next`).
  Keeping the shopper on the page they came from is a follow-up, not this change.
- Fix round 2 supersedes the original push/replace close rule: read `window.navigation?.canGoBack` at dismissal; true uses
  `router.back()`, false/undefined replaces with locale home. Gate replacements go to the same-origin page before the protected
  page, else home. Keep only the latest `{origin, opener}` for focus; no entries, traversal flags or navigation kinds. Preserve
  opener Tab order, and schedule both opener and heading focus after dialog teardown. The header link on canonical login stays plain.
- Docs and contracts as planned: no change in `docs/contracts/`; README, `docs/files/storefront.md`, `e2e/README.md`, CHANGELOG, HANDOFF.
