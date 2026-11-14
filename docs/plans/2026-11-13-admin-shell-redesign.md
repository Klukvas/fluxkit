# Admin shell redesign

- Status: PR 1 implemented and verified on branch claude/admin-sidebar-icons-95ad74; PR not opened yet.
- Owner request: 2026-11-13, make `apps/admin` easier to navigate through three separate PRs.
- Scope: admin core presentation; permission filtering, routes, session operations and domain behaviour stay intact.

## Three PRs

| PR | Scope | Completion boundary |
|---|---|---|
| 1 | Icons, collapsible desktop sidebar, reordered navigation, pinned Help, compact header and account disclosure | Design below; existing Button API; no page action redesign or dashboard counters |
| 2 | Later, own session | Button and page-header consistency |
| 3 | Later, own session | Start page as a workspace |

- **PR 2 — later, own session:** adds Button `ghost`, leading `icon`, `IconButton` and shared `PageHeader`; page headers contain at most one primary action. It reuses PR 1 icons, preserves translated names and permission checks, and owns its separate plan, compatibility review and verification.
- **PR 3 — later, own session:** adds counters from existing reads (`GET /admin/orders?status=` exposes `total`; `GET /admin/payments?needsAttention=true` supplies the attention list), plus quick actions filtered by operation permission. It keeps the getting-started checklist and defines loading/error states without new endpoints. Counter semantics and permission-specific reads belong to that session.

## Existing functionality to reuse

| Files | Behaviour today |
|---|---|
| `apps/admin/src/layout/shell.tsx` | `ShellFrame` renders header, responsive Menu, aside, main, skip link and loading announcement; `Shell` owns route gate, title, context Help and unsaved registry. Menu controls `admin-account admin-navigation`, closes on `location.key` and Escape. |
| `apps/admin/src/layout/navigation.ts`, `navigation.spec.ts` | Ordered route-id groups, route-derived paths/permissions/titles, filtering and empty-group removal; `/` matches exactly in `isCurrentPath`. |
| `apps/admin/src/routes.ts`, `router/paths.ts`, `permissions.ts` | Home already exists at `/`, operation `getMe`, permission `authenticated`; signed-in sessions with `[]` permissions still see authenticated screens. No route edits are necessary. |
| `apps/admin/src/layout/user-menu.tsx` | Inline signed-in email, Account and Sign out; `useConfirmLeave`, pending state and failure alert already exist. |
| `apps/admin/src/layout/language-switch.tsx` | uk/en buttons, loading failure alert and `aria-disabled` preserve focus; keep this component and behaviour. |
| `packages/ui/src/side-nav.tsx`, `admin-nav.spec.tsx` | Optional group headings, labelled lists, router adapter, current item filled with primary; no icon/collapse props. |
| `packages/ui/src/button.tsx`, `styles.ts`, `index.ts` | Existing secondary Button accepts children/ref/native attributes; shared focus ring, typography and public exports suffice. No Button or styles edits in PR 1. |
| `apps/storefront/src/components/icons.tsx` | Own decorative line SVG pattern; copy the approach, do not import across apps or replace storefront icons. |
| `packages/theme/src/tokens.css`, `contrast.spec.ts`, `theme-run.testing.ts` | Existing semantic pairs; contrast checks use effective storefront modes and admin light values, including filled fork overrides. |
| `apps/admin/src/i18n/i18n-context.tsx`, `locale-preference.ts`, `areas/help/checklist-storage.ts` | One lazy `browserStorage` accessor; language and checklist storage catch failures. |
| `apps/admin/build-output.spec.ts`, `src/source-guards.spec.ts` | Built initial JS caps 445,000 raw / 135,000 gzip; one storage reference; source accessor-user allowlist. HANDOFF records 440,712 raw / 131,534 gzip, not a fresh measurement. |
| `apps/admin/src/views/views.spec.tsx`, `e2e/support/fixtures.ts` | Static shell/user markup checks; fixtures currently wait for visible Sign out, which the disclosure changes. |

- Repository-wide `SideNav` search finds one production caller: admin shell. Other callers are `packages/ui/src/admin-nav.spec.tsx` and `no-hardcoded-text.spec.tsx`; storefront account navigation uses its own markup. Client forks may add callers.
- Existing admin e2e navigation consumers: `banners`, `search`, `payments`, `privacy`, `roles`, `users`, `shipping`, `email`, `help`, `keyboard`, `serving`; header consumers also include `sign-in`, `session` and shared fixtures.

## PR 1 file-level design

| Add/change | Responsibility |
|---|---|
| Add `packages/ui/src/icons.tsx`, `icons.spec.tsx`; change `index.ts` | Export the icon family below; test decorative SVG invariants, no text, distinct named exports. |
| Change `packages/ui/src/side-nav.tsx`; add `side-nav-tooltip.tsx` | Additive props below; icon/hidden-label markup, separators, opt-in muted current item; isolated client tooltip for collapsed items only. |
| Change `packages/ui/src/admin-nav.spec.tsx`, `no-hardcoded-text.spec.tsx` | Cover default compatibility, opt-in appearance and collapsed markup; include icon/collapse fixtures in the translated-text guard. |
| Change `packages/theme/src/contrast.spec.ts` | Explicit current-item assertion on effective admin values; no token, mapping or override edits. |
| Change `apps/admin/src/layout/navigation.ts`, `navigation.spec.ts` | Config shape/order/icons below; keep route-derived permissions and empty-group dropping. |
| Add `apps/admin/src/layout/sidebar-preference.ts`, `sidebar-preference.spec.ts`, `use-sidebar-collapsed.ts` | Small preference codec and hook, with injected accessor in pure tests; browser binding stays in preference module. |
| Change `apps/admin/src/layout/shell.tsx` | Desktop frame, separately rendered Help, collapse control and responsive panels; presentation props carry collapse state and callbacks from `Shell`. |
| Change `apps/admin/src/layout/user-menu.tsx` | Compact account disclosure and focus handling; preserve existing sign-out path. |
| Change `apps/admin/src/messages/{uk,en}/{shell,navigation}.json` | Add shell labels and catalog-setup heading; existing route labels remain. |
| Change `apps/admin/src/i18n/{i18n-context.tsx,locale-preference.ts}` | Correct storage comments to include panel preference and existing checklist; accessor implementation remains the only storage reference. Non-personal language/sidebar keys share `BROWSER_PREFERENCE_KEYS` in `locale-preference.ts`, keeping both keys beside the accessor in the built shared chunk. |
| Change `apps/admin/src/source-guards.spec.ts`, `apps/admin/build-output.spec.ts` | Add exact accessor consumer; update storage wording; record fresh before/after budget measurements. Only exceeded budget caps may move to about the measured size plus 1 %, after trimming (orchestrator decision). |
| Change `apps/admin/src/views/views.spec.tsx`; add `layout/user-menu.spec.tsx` | Static shell variants, translated labels, controlled open/closed account view and failure/pending states. |
| Add `apps/admin/e2e/tests/shell.e2e.ts`; change `e2e/support/fixtures.ts`, `tests/{sign-in,session,serving,help,roles}.e2e.ts` | New interactions/matrix; adjust hidden account actions and separate Help landmark locators; preserve domain scenarios. |
| Change docs listed below | Document implemented behaviour and actual evidence only. |

### SideNav API and compatibility

- Exact interfaces after PR 1 (existing exports remain):

```ts
export interface SideNavItem {
  id: string;
  label: string;
  href: string;
  current?: boolean;
  icon?: ReactNode;
}
export interface SideNavGroup {
  id: string;
  heading?: string;
  items: SideNavItem[];
}
export interface SideNavLinkProps {
  href: string;
  className: string;
  "aria-current"?: "page";
  children: ReactNode;
}
export interface SideNavProps {
  label: string;
  groups: SideNavGroup[];
  headingAs?: "h2" | "h3";
  renderLink?: (link: SideNavLinkProps) => ReactNode;
  collapsed?: boolean;
  currentTone?: "solid" | "muted";
}
```

- Defaults: `collapsed=false`, `currentTone="solid"`; existing callers retain their appearance. Admin explicitly passes `currentTone="muted"` in both responsive forms. `renderLink` still receives and spreads all existing props and children.
- Expanded icon item: link contains decorative, non-shrinking `size-6` icon and visible label, separated by token spacing. No icon means the original label layout.
- Collapsed icon item: retain the real label inside `<span className="sr-only">`; icon is decorative; `aria-current="page"` remains on the link. Never replace the accessible name with only `aria-label`. Missing icon falls back to visible text rather than an empty link.
- Group headings remain in the DOM as `sr-only` headings, and their `ul` retains `aria-labelledby`; a decorative `border-border` separator replaces each visible heading. Headingless daily work remains a plain list. Instance-scoped heading ids avoid collisions between responsive copies.
- `side-nav-tooltip.tsx` is a small `"use client"` wrapper around collapsed links; `SideNav` remains usable from server components. Expanded/default rendering has no tooltip wrapper or browser work.
- Tooltip uses a native manual popover in the top layer, so the sidebar's scrolling container cannot clip it; no portal, new package, stylesheet injection or dependency on `react-dom` is required.
- Pointer enter and focus capture open it; pointer exit/blur close it when neither trigger nor tooltip is hovered/focused. Its padded surface touches the trigger edge, so pointer movement into it keeps it visible. Escape dismisses until a new hover/focus interaction and keeps link focus.
- Fixed coordinates derive from the trigger's bounding rectangle; logical inline end follows computed direction. Clamp to the viewport, reposition on scroll/resize, remove listeners on close/unmount, and hide on responsive visibility changes. Coordinates are measured geometry, not hardcoded design sizes.
- Tooltip text repeats the translated label with `aria-hidden="true"`; screen readers receive the link's retained text once. Style uses `bg-background text-foreground`, `rounded-control`, `shadow-overlay`, token padding and focus-ring conventions. Browser tests verify popover support and clipping in supported Chromium; Safari/Firefox remain unverified.

### Current item and icons

- Admin current item uses opaque `bg-muted text-foreground` (a secondary tint), no alpha blend, with `aria-current` and font weight. Unselected hover remains `hover:bg-muted`; default solid callers retain `bg-primary text-primary-foreground`.
- `contrast.spec.ts` already lists `["foreground", "muted", textMinimum]`. Keep it; add test `admin current navigation item: foreground on muted is at least 4.5:1` with this exact assertion:

```ts
expect(contrastRatio(
  adminTokens.get("--fk-color-foreground") as string,
  adminTokens.get("--fk-color-muted") as string,
)).toBeGreaterThanOrEqual(4.5);
```

- This runs on both real and filled-fork configs; existing effective-set checks cover storefront dark/system palettes too. No change to `tokens.css`, `tailwind.css` or the theme-token contract.
- Icon API: each named function has `(props: IconProps): ReactElement`; `export type IconProps = Pick<SVGProps<SVGSVGElement>, "className">`. Size comes from `size-6` by default and token-based caller classes; geometry stays in 24×24 coordinates.
- Internal SVG primitive fixes `viewBox="0 0 24 24"`, `stroke="currentColor"`, `fill="none"`, line caps/joins, consistent stroke width, `aria-hidden="true"`, `focusable="false"`; callers cannot override accessibility or stroke invariants.
- Names: `HomeIcon`, `OrdersIcon`, `ProductsIcon`, `CustomersIcon`, `PaymentsIcon`, `CategoriesIcon`, `BrandsIcon`, `ProductTypesIcon`, `AttributesIcon`, `OptionsIcon`, `BannersIcon`, `SearchIcon`, `ShippingIcon`, `EmailIcon`, `PersonalDataIcon`, `AuditLogIcon`, `AdministratorsIcon`, `HelpIcon`, `SidebarCollapseIcon`, `SidebarExpandIcon`, `PlusIcon`, `ChevronIcon`, `ExtensionIcon`.
- Collapse/expand directional artwork mirrors through `rtl:` transforms; Chevron points down by default. Named exports enable unused Plus and other later icons to tree-shake. One file replaces the icon family per client fork.

### Navigation configuration and shell

- Config types: `NavigationItemConfig = { routeId: RouteId; icon: ComponentType<IconProps> }`; `NavigationGroupConfig = { id: NavigationGroupId; headingKey?: string; placement?: "main" | "bottom"; items: readonly NavigationItemConfig[] }`; `NAVIGATION: readonly NavigationGroupConfig[]`. Absent placement means main.
- Filtered groups preserve optional heading/placement; items carry the icon component plus existing route-derived label/path/permission. Shell instantiates icons and only translates a defined heading key.

| Group id | Heading key | Route ids in order | Placement |
|---|---|---|---|
| `sales` | absent | `home`, `orders`, `products`, `customers`, `payments` | main |
| `catalog` | `nav.group.catalogSetup` | `categories`, `brands`, `productTypes`, `attributes`, `options` | main |
| `storefront` | `nav.group.storefront` | `banners`, `search` | main |
| `settings` | `nav.group.settings` | `shipping`, `email`, `privacy`, `auditLog`, `users` | main |
| `help` | absent | `help` | bottom |

- The headingless daily group keeps the contract id `sales`; feature entries naming `sales` join it after the core items. Feature entries use `ExtensionIcon`; the manifest has no `icon` field. Such a field is a possible later contract addition, not part of PR 1.
- `visibleNavigation` filters every item via `routeById`/`canAccess`, then drops empty groups. Home and Help survive for signed-in `[]`; neither appears for `null`. `getMe` is an operation, not a literal permission string.
- `Shell` partitions filtered groups by placement. `ShellFrame` renders main `SideNav` labelled `shell.navLabel` and a separate footer `SideNav` labelled `page.help.title`; Help is not duplicated in the main nav. Footer and collapse button stay together at the bottom.
- Desktop (`md` and above): two-column grid, sidebar spans header/main rows; aside is `sticky top-0 h-dvh`, `w-64` expanded / `w-20` collapsed. A `min-h-0 flex-1 overflow-y-auto` navigation area scrolls independently; footer does not shrink. Main remains `min-w-0`; header occupies the content column. Use existing spacing utilities, border roles and responsive classes.
- Desktop panel id is `admin-navigation-desktop`; collapse Button has `aria-controls="admin-navigation-desktop"`, `aria-expanded={!collapsed}`, translated action text (visually hidden when collapsed), and the matching decorative icon. It never hides the nav landmark. Focus stays on the button after toggling.
- Mobile: keep the existing single Menu button controlling `admin-account admin-navigation`; account controls remain inside that panel. Mobile aside is always expanded when open; collapse button is absent. Menu closes on navigation including same-page links, on Escape with focus return, and on button activation.
- Render separate CSS-hidden mobile/desktop nav panels through one shared render function: mobile uses `collapsed=false`, desktop uses the stored value. No JS breakpoint constant, media subscription or duplicated account controls. Hidden panels have no keyboard stops; group ids are unique per SideNav instance.
- Header stays compact: brand link, mobile Menu, language switch, account trigger. Language remains visible on desktop and within the open mobile account panel, preserving current phone behaviour; no theme toggle or page-action changes.

### Collapse preference

- Key: `fluxkit.admin.sidebarCollapsed`, browser-wide, no user id or personal data. Encode exactly `"true"` / `"false"`; missing or invalid data means expanded.
- `sidebar-preference.ts` imports the existing `browserStorage` from `i18n/i18n-context.tsx`; `readSidebarCollapsed(getStorage = browserStorage): boolean` and `storeSidebarCollapsed(collapsed, getStorage = browserStorage): boolean` wrap accessor invocation AND get/set in try/catch.
- `useSidebarCollapsed` lazily reads once and exposes `{ collapsed, toggle }`. Toggle writes first; success adopts the next value; failure explicitly sets expanded. No write-on-mount effect, render write or storage-event synchronisation. Mobile visibility never writes a preference; resizing back restores it.
- Catch branches implement the owner-requested expanded fallback and return a result, with a reason comment; they do not hide application/API failures. Tests cover getter throws, getItem/setItem throws, missing/invalid values and round-trip.
- `source-guards.spec.ts` adds only `layout/sidebar-preference.ts` to the exact accessor-user allowlist. `build-output.spec.ts` retains `expect(uses).toHaveLength(1)` and the locale-key assertion; add an assertion that the same chunk contains the sidebar key. No second direct storage access.

### Account disclosure and keyboard behaviour

- `UserMenuView` renders a labelled wrapper, a small secondary Button with visually hidden `shell.userMenu`, decorative initials and Chevron, `aria-expanded`, and `aria-controls` referencing a unique popup id. Initials use up to two letters from the email local part (Unicode-aware); empty email uses the decorative `AdministratorsIcon` silhouette. Email is never persisted.
- Popup is an absolutely positioned, end-aligned labelled section containing signed-in email, the existing Account link and Sign out Button; width is constrained to the viewport, email wraps, colours/radius/shadow use existing tokens.
- Use a disclosure of ordinary links/buttons, not `role="menu"`: Enter/Space toggles; Tab/Shift+Tab follows native order without trap or arrow-key promises. Opening keeps focus on trigger; next Tab reaches Account. Escape closes and focuses trigger through `useFocusAfterCommit`; outside pointer/focus closes without stealing focus. Listeners clean up.
- Escape inside the popup stops propagation so it closes only the account disclosure; the next Escape can close mobile Menu and return focus to its opener. Route changes and closing the mobile account panel also close the popup; hidden stale popups never reappear on resize.
- Keep `useConfirmLeave` and the existing sign-out callback unchanged. Pass `confirmationOpen={leave.dialog !== null}` to the view; suspend outside-focus dismissal during confirmation and keep the popup mounted/open so Stay can restore focus to Sign out. On failure show the existing `role="alert"` visibly outside the dismissible popup, with pending/disabled state preserved. No auth/permission or network logic changes.

### Messages

| File / key | uk | en |
|---|---|---|
| `shell.json`: `shell.collapsePanel` | Згорнути панель | Collapse panel |
| `shell.json`: `shell.expandPanel` | Розгорнути панель | Expand panel |
| `shell.json`: `shell.userMenu` | Меню облікового запису | Account menu |
| `navigation.json`: `nav.group.catalogSetup` | Налаштування каталогу | Catalog setup |

- Reuse existing `shell.userLabel`, `shell.signedInAs` (`Ви увійшли як {email}` / `Signed in as {email}`), `shell.account` (`Мій обліковий запис` / `My account`), `shell.signOut` (`Вийти` / `Sign out`), `shell.signingOut`, Menu and route-title keys, including Home's current `Головна` / `Start` and payment attention wording.
- Keep unused old group keys for fork overrides; do not rename route titles for cosmetic nav wording. `messages-overrides/{uk,en}.json` remain untouched and continue to merge last. Existing parity/placeholder/override specs validate all additions.

## Tests and documentation in PR 1

- UI unit: `icons.spec.tsx`; `admin-nav.spec.tsx` asserts default solid compatibility, opt-in muted classes, icon decoration, retained hidden names, heading/list association, separators, missing-icon fallback and router-prop forwarding; `no-hardcoded-text.spec.tsx` includes new variants.
- Admin unit: update `navigation.spec.ts` order, uniqueness, icon coverage, first heading absence, bottom Help, role and empty/null cases, Home exact-current matching; preserve mobile `location.key` guard. Add preference tests above; `views/views.spec.tsx` covers shell ids/controls and controlled disclosure states; `user-menu.spec.tsx` covers initials, empty email, translated pending/failure rendering. Existing message, focus, theme and source guards remain enabled.
- New `shell.e2e.ts`: toggle by pointer/keyboard, aria/name/current state, navigation and reload persistence; blocked accessor/read/write expanded fallback; mobile ignores saved collapse, closes on same-page navigation and Escape; desktop/mobile resize; unique visible landmarks; pinned Help; scrolling, focus and hover tooltip visibility outside sidebar bounds, Escape dismissal and pointer transfer into tooltip.
- Same e2e file covers account open/close, Tab order, Escape focus return, outside click/focus, nested mobile Escape, Account navigation, long email wrapping, failure alert and one pending sign-out. Storage-denial scenarios intercept storage only, leaving the real UI under test.
- Update fixtures `signIn`/`openAs` to await the visible Account menu trigger without opening it. `sign-in.e2e.ts` opens account before email/sign-out assertions; `session.e2e.ts` opens it before header sign-out and checks Stay focus/input retention; reauth-dialog locators stay unchanged. `serving.e2e.ts` checks the trigger survives chunk failures.
- `help.e2e.ts` targets the separate Help navigation landmark; `roles.e2e.ts` verifies Home and permission-filtered links in both modes. Existing `keyboard.e2e.ts` remains a regression for heading and language-button focus. Other named nav consumers retain `Admin sections` and current route labels; run them all, change no locator speculatively.
- Docs: `docs/files/ui.md` (icons/tooltip/props), `docs/files/admin.md` (layout, preference, guards, tests), `packages/ui/README.md` (additive SideNav API/client tooltip), `apps/admin/README.md` (responsive shell, account disclosure, stored preference), `apps/admin/e2e/README.md` (new scenarios and limits), `CHANGELOG.md` (user-visible shell), `docs/HANDOFF.md` (section 1 entry and Last updated). No API/config/seed/contract docs need changes.

## Risks and handling

| Risk | Handling |
|---|---|
| Entry bundle headroom | Measure entry plus static imports before/after, raw and gzip level 9 as the built spec does; named SVG exports, no library, no portal runtime. Preserve caps first; record both measurements in its existing comment block. |
| Storage rule | Same accessor; narrowly extend source allowlist and wording, keep one built storage occurrence. Explicit expanded fallback on every failure. |
| Stale e2e locators | Fix shared fixtures first; open account before actions; separate Help locator; preserve main landmark/route labels and full suite. |
| Contrast in forks | Opaque existing foreground/muted pair, effective admin assertion in both theme runs; no untested primary-alpha blend. |
| RTL and token sizing | Use `border-e`, `ms`/`me`, `start`/`end`, direction-aware tooltip placement and mirrored directional icons; token utilities, no raw palette/radius/spacing. Probe `dir=rtl` even though shipped locales are LTR. |
| Fork SideNav overrides | Additive defaults, unchanged router adapter and text fallback; document changed children for opt-in icon users, test a no-icon custom renderer. |
| Short viewport / tooltip clipping | Independently scroll main nav, fixed footer, native top-layer tooltip, viewport clamping and measured geometry; test bottom items after scrolling. |

## Verification and evidence

- Run from this worktree, with Node 22 / pnpm 10.28 and real test services; record each exit code separately: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm check:boundaries`, `pnpm check:env`, `pnpm test`.
- Budget baseline and after: `pnpm build`, then `pnpm --filter @fluxkit/admin test build-output.spec.ts`; record measured raw/gzip totals from the same manifest/static-import traversal, not Vite's per-file summary alone.
- Admin browser suite after build: `pnpm --filter @fluxkit/admin test:e2e`; isolated iteration: `pnpm --filter @fluxkit/admin test:e2e shell`. Services and disposable `E2E_DATABASE_URL` ending `_e2e_test` follow `apps/admin/e2e/README.md`; never use a development database. `pnpm test` uses a different `_test` database.
- Additional docs check: `pnpm check:docs`. Full suite includes both real/fork theme runs; no snapshot-update, weakened guard or dependency install as a substitute for verification.
- Screenshot matrix: widths **1440, 1024, 768, 390 px** × saved **expanded/collapsed** × **light/dark** = 16 captures in uk (orchestrator decision). At 390, Menu is open for navigation captures and both saved states render expanded; Menu-closed header behaviour is covered by e2e without additional captures. At 768, desktop collapse is active.
- Dark captures force `data-theme="dark"` as a palette probe only; the admin has no dark mode of its own (ADR 0047).
- Capture at a documented common height plus a short-height scroll probe; include current item, hovered/focused tooltip, footer and open account popup. Assert no horizontal overflow, overlap, clipping or unreachable controls; add an RTL geometry probe. Artifacts stay ignored test outputs, not new committed baselines.
- **Implementation evidence:** actual builds, bundle measurements and unit checks are recorded in Results (PR 1). E2E, integration tests and screenshots are run by the orchestrator. Screen readers, Safari/Firefox, real client-fork layouts and production dark-mode support remain outside the Chromium evidence.

## Red zones and instruction review

- No red zone is expected: no dependency, schema/migration, API/config/event/feature-boundary change, token change, auth/permission change or destructive action. Sign-out presentation keeps the existing operation and leave confirmation. SideNav additions are internal under `docs/contracts/README.md`; existing defaults remain compatible.
- **Budget decision (orchestrator-authorized, rebased):** initial JS is 456 996 raw / 136 998 gzip (baseline 447 298 / 133 774). Both exceeded caps move to measured size plus about 1 %: raw 450 000 → 461 600; gzip 135 000 → 138 400. No other cap changes.
- **Review decision:** the account popup keeps Tailwind `z-10`, following the existing storefront popover approach (`z-30` in `apps/storefront/src/app/globals.css`). There is no z-index token; adding one changes the theme-token contract (AGENTS.md section 14), so PR 1 adds none.

## Results (PR 1)

- Review fixes retain `nav.group.sales` and `nav.group.catalog` for fork overrides; a regression spec validates both keys in uk and en. Fix-round verification (Node 22.23.5): admin tests pass (175 files, 2 057 tests); lint, format check, typecheck and docs check each exit 0. The regression fails before restoring the key and passes afterwards. This round does not rerun builds, e2e or screenshots; bundle numbers below are the recorded rebased measurement.
- PR 1 provides shared decorative icons, remembered desktop collapse, role-filtered daily-work navigation, pinned Help, a scrolling sidebar and compact account disclosure. Mobile keeps the expanded Menu panel. PRs 2 and 3 remain separate later sessions; no dependency, API, migration or theme-token change.
- Orchestrator verification uses Node 22.23.5 and real Postgres 17, Redis 8 and Meilisearch v1.55.0 in Docker.
- Final entry bundle (entry plus static imports, gzip level 9, 3 chunks): **456 996 raw / 136 998 gzip bytes**, before **447 298 raw / 133 774 gzip** (main after blog PR 5, Node 22); delta **+9 698 raw / +3 224 gzip**. Caps are **461 600 raw / 138 400 gzip**.

| Command | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm check:boundaries`, `pnpm check:env` | Each exits 0. |
| `pnpm test` | Every package passes except `@fluxkit/api`: 2 of 259 files fail on macOS, also without this change. `local-media-storage.spec.ts` expects `/proc`; `delete-abandoned-uploads.job.spec.ts` expects `EISDIR`. PR 1 changes no API file. Admin: 166 files pass; UI: 16; theme: 7 plus 8 in the fork run, all pass. |
| `pnpm --filter @fluxkit/admin test:e2e` | 72 pass, 1 fails: `email.e2e.ts:69`, "No mail matches" after a second Recipient filter. It fails identically on clean `main` (`8296a167`) in the same environment; it is pre-existing. |
| Shell and screenshot run | `shell.e2e.ts` passes; 29 tests pass together with the screenshot run. The RTL tooltip scenario passes after `inset-auto` fixes the UA popover `inset` override that caused one failure. |

- Separate Codex QA: one major (focus after My account → Stay with unsaved input) and three minors are fixed: clipped navigation focus outlines, an e2e request-count race and a tooltip surface without a visible edge (now `border border-border`). Tooltip lazy-loading (~0.3 KB gzip) is declined: the saving does not justify a lazy boundary in the shared UI library.
- Screenshots cover uk UI at 1440, 1024, 768 and 390 px, expanded/collapsed (390 px: Menu open/closed), in light and forced `data-theme="dark"`, plus the collapsed tooltip and open account menu. Forced dark is a palette probe; the admin has no dark mode of its own. At a 900 px tall window the expanded sidebar scrolls, with Settings items below the fold; the collapsed form fits.
- **Not verified:** screen readers, Safari, Firefox, a real client fork and CI.
