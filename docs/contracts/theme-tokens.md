# Contract: design tokens

Status: draft (introduced in plan step 7). Covered by SemVer; renaming or removing a token is a breaking change. Adding a token is additive (minor).

Source of truth: `packages/theme/src/tokens.css` (the template's values). A client fork sets its own values in the fork-owned
`packages/theme/src/brand-overrides.css` (the shop: storefront, and its light rule for the admin) and `packages/theme/src/admin-overrides.css`
(the admin alone), see "Storefront overrides" and
"Admin" below. Components use semantic Tailwind utilities mapped in `packages/theme/src/tailwind.css`; never raw values.

| Token | Tailwind utility | Purpose |
|---|---|---|
| `--fk-color-background` / `-foreground` | `bg-background` / `text-foreground` | page background and text |
| `--fk-color-muted` / `-muted-foreground` | `bg-muted` / `text-muted-foreground` | secondary surfaces and text |
| `--fk-color-border` | `border-border` | decorative borders and dividers (cards, badges, buttons); NOT for the line that identifies a control |
| `--fk-color-border-input` | `border-border-input` | the border of inputs, textareas, selects and checkboxes (WCAG 1.4.11, at least 3:1; added after the storefront step 10 review) |
| `--fk-color-primary` / `-primary-foreground` | `bg-primary` / `text-primary-foreground` | primary actions |
| `--fk-color-accent` / `-accent-foreground` | `bg-accent`, `border-accent` / `text-accent-foreground` | a second brand colour: the `accent` tone of a home banner card (`BannerCard`), otherwise **reserved for client code**. Light: ochre `#b17b15` (the concept's butter darkened for contrast), dark: butter `#ffd166`, both with ink text ("Playful defaults" below). Added 2026-11-08 |
| `--fk-color-danger` | `text-danger`, `bg-danger`, `border-danger` | destructive and error states |
| `--fk-color-danger-foreground` | `text-danger-foreground` | text on a `danger` fill, such as the header's cart count badge (added 2026-11-02) |
| `--fk-color-success` | `text-success`, `border-success` | success and availability (added in storefront plan step 4a) |
| `--fk-color-warning` | `text-warning`, `border-warning` | notices such as changed prices (added in step 4a) |
| `--fk-color-ring` | `outline-ring`, `ring-ring` | visible keyboard focus (added in step 4a) |
| `--fk-radius-sm` / `-md` / `-lg` | `rounded-sm` / `rounded-md` / `rounded-lg` | the radius size steps. Kept for forks' own components (additive); the template's code uses the role radii below and these steps only through the guard's exception list |
| `--fk-radius-control` | `rounded-control` | buttons, fields, selects, chips, pagination, menu entries and header links, focus targets (a focused section's outline), and popups anchored to a field (menus, suggestion and combobox lists, the search hint). Default `1.5rem`. Added 2026-11-09 |
| `--fk-radius-card` | `rounded-card` | product, banner and order cards (and their skeletons), `Card`, the hero, the admin banner preview frame, the admin search `LocaleCard`. Default `1.5rem`. Added 2026-11-09 |
| `--fk-radius-panel` | `rounded-panel` | inline panels inside a page: notices, empty-result boxes, `Alert`, the `TrustBar` list container (the `<ul>` frame, not its items), the `DataTable` scroll hint, admin sections, fieldsets, list rows and the mail preview frame. Default `1rem`. Added 2026-11-09 (owner decision on the review of PR 246) |
| `--fk-radius-overlay` | `rounded-overlay` | free-floating surfaces over the page: `Dialog`, the add-to-cart toast. Default `1.5rem`. Added 2026-11-09 |
| `--fk-radius-media` | `rounded-media` | product and banner pictures, gallery thumbnails, `ProductImage`, `StoreImage`, `Skeleton` (it stands in for loading content). Default `1rem`. Added 2026-11-09 |
| `--fk-font-sans` / `-mono` | `font-sans` / `font-mono` | font stacks |
| `--fk-font-display` | `font-display` | the heading face of the `pageTitle` and `sectionTitle` roles and the text logo (`.fk-logo`); default = the `--fk-font-sans` stack (a test asserts the equality). May be `var(--font-...)` from `apps/storefront/src/config/fonts.ts` (section "Fonts"). Added 2026-11-08 |
| `--fk-shadow-card` | `shadow-card` | card elevation (resting) |
| `--fk-shadow-raised` | `shadow-raised` | a raised surface: the hovered product card (added 2026-11-03, design batch A) |
| `--fk-shadow-overlay` | `shadow-overlay` | surfaces over the page: menus, toasts, bars (added 2026-11-03) |
| `--fk-font-size-{xs,sm,base,lg,xl,2xl,3xl,4xl}` / `--fk-line-height-{same steps}` | `text-xs` ... `text-4xl` (size and line height) | the type scale (added 2026-11-03; values = Tailwind's defaults, so nothing moved) |
| `--fk-space-unit` | every spacing utility (`p-4` = 4 units, `gap-2`, `m-6`, `size-11`, ...) | the spacing unit, 0.25rem (added 2026-11-03) |

## Playful defaults (2026-11-14)

- Light accent: ochre `#b17b15` with ink text, the concept's butter `#ffd166` darkened until the three accent pairs pass on cream (butter itself is 1.32:1 there, below the 3:1 of `accent`/`background`); the dark theme uses butter as is. No contrast guard is relaxed and no colour token is added. A pure butter fill in light mode needs a new colour token or a changed accent pair: an owner decision.

| Colour role | Light | Dark (also system on a dark device) |
|---|---|---|
| background / foreground | `#fff3e3` / `#2b1a12` | `#1f130d` / `#fff3e3` |
| muted / muted-foreground | `#fae9d3` / `#75543e` | `#352217` / `#d2b397` |
| border / border-input | `#d9b997` / `#957052` | `#65432e` / `#b58b68` |
| primary / primary-foreground | `#db3b18` / `#ffffff` | `#ff7959` / `#2b1a12` |
| accent / accent-foreground | `#b17b15` / `#2b1a12` | `#ffd166` / `#2b1a12` |
| danger / danger-foreground | `#b83224` / `#ffffff` | `#ff9380` / `#2b1a12` |
| success / warning | `#326b44` / `#925d0d` | `#9be3c0` / `#ffd166` |
| ring | `#db3b18` | `#ff7959` |

- Radius roles: control/card/overlay `1.5rem`, panel/media `1rem`; scale sm/md/lg `0.375rem` / `0.75rem` / `1.5rem`. Small marks retain the sm step. Type scale and spacing unit stay unchanged.
- Shadows: card `3px 3px 0 0`, raised `5px 5px 0 0`, overlay `6px 6px 0 0`, all in ink `#2b1a12` (light) or near-black brown `#090503` (dark); no blur.

Design kit rules (review D-19, plan `docs/plans/2026-11-03-storefront-design-a.md`; enforced by `packages/theme/src/design-guard.spec.ts`): font sizes only
`text-xs` to `text-4xl`, radii only the roles `rounded-control|card|panel|overlay|media` (plus the shape `rounded-full` and `rounded-none`; the steps
`rounded-sm|md|lg` only through the exception list, since 2026-11-09), shadows only `shadow-card|raised|overlay|none`; a
step outside a scale (`text-5xl`, `rounded-xl`, `shadow-md`) would use a Tailwind built-in value that a rebrand of `tokens.css` cannot reach. Text roles
are class strings in `@fluxkit/ui` (`textStyles`), built from these tokens. Names are roles, not looks,
so a dark theme only sets values. Controls have no colour transition: it would also animate `outline-color`, so the focus ring would fade in.

**Radius roles (2026-11-09, plan `docs/plans/2026-11-08-design-changeability.md` T3; additive):**

- A component's radius names its ROLE, not a size: a rebrand sets `--fk-radius-card: 0` and only cards turn square. Each role token is a
  literal rem value (not `var(--fk-radius-md)`; `theme.spec.ts` checks it), equal to the step its parts used before, so the default look
  did not change (computed styles and screenshots compared by the CI job `visual`).
- Which role: `control` for anything you press or type into and the popups anchored to it (a menu belongs to its button, a suggestion list
  to its field); `card` for cards and large surfaces in the page flow; `panel` for inline frames inside a page (a notice, an empty result,
  an alert, an admin section or fieldset); `overlay` for free-floating surfaces (dialogs, toasts); `media` for pictures. `rounded-full` stays the shape of pills, avatars, spinners and count badges (not a role); `rounded-none` removes a radius.
- Mail keeps the size steps (`emailTheme.radius`, no role: the `EmailTheme` contract is unchanged; known limit: mail buttons do not follow
  `--fk-radius-control`).
- **Known limit, exception list (6 uses in 6 files, `radiusExceptions` in `packages/theme/src/design-guard.spec.ts`, each with its exact
  count and reason):** the small marks (now 0.375rem) have no role (owner decision 2026-11-09) and keep `rounded-sm`: `Checkbox`, `Badge`, the discount
  badge of `PriceText`, the product card's brand link focus shape, the language flags `.fk-flag`, the admin order line thumbnail. A fork
  restyles them with `--fk-radius-sm`.
- The guard also refuses the Tailwind v4 forms `rounded-(--var)` and `rounded-(length:--var)`, arbitrary `rounded-[...]`, and a step with the
  important marker (`rounded-md!`, `!rounded-lg`); `@apply` rules in CSS files are scanned like class lists.
- Role notes (review of PR 246), what a fork should know before changing a role:
  - The plan's line "`media` defaults to the `card` value" was overridden: pictures used `rounded-md` (0.5rem) and cards `rounded-lg` (1rem),
    so `media` = 0.5rem keeps the pixels. A fork that wants pictures as round as cards sets both.
  - `Skeleton` is `media`: it also stands in for text lines, so a fork that sets `--fk-radius-media: 0` gets square text-line skeletons too.
  - Focus-only targets (a block that takes the focus after an action: the delivery and payment sections, the form error summary, the
    order and payment-return status, the account data views) are `control`, because their radius only shapes the focus outline: a fork with pill controls
    (`--fk-radius-control: 9999px`) gets pill-shaped focus outlines around those sections; give them `panel` in a fork if that looks wrong.
  - Admin repeated list items are mostly `panel` (they were `rounded-md`): `ShipmentCard`, `PaymentCard`, the media rows of a product,
    the banner rows and option blocks. The per-language `LocaleCard` of the search status (`apps/admin/src/areas/search/search-status-view.tsx`)
    is the odd one: it was `rounded-lg` (1rem) and stays `card`; making it a panel would be a visual change (1rem to 0.5rem) and was not made.

**Heading roles (2026-11-08, plan `docs/plans/2026-11-08-design-changeability.md` T1; additive):**

| Role | Classes today | Used for |
|---|---|---|
| `pageTitle` | `font-display text-3xl font-bold text-foreground` | a page's `h1` (the hero adds `md:text-4xl`) |
| `pageTitleCompact` | `text-2xl font-bold text-foreground` | the `h1` of the error and not-found views; the order page adds `sm:text-3xl` |
| `sectionTitle` | `font-display text-xl font-semibold text-foreground` | a section `h2`, a form section's `legend`, the `Disclosure` heading |
| `subsectionTitle` | `text-lg font-semibold text-foreground` | smaller `h2`/`h3`, the `EmptyState` heading, the result count, the filter sheet title |
| `itemTitle` | `font-semibold text-foreground` | body-size headings: a line item, a short list, a field group's `legend` |
| `cardTitle` | `font-medium text-foreground` | the product card's name (the card adds `line-clamp-2`), the `OptionPicker` legend |
| `dialogTitle` | `text-lg font-semibold` | a `Dialog` title and the `BannerCard` title: no colour, the surface (a toned banner) sets it |
| `navGroupTitle` | `text-sm font-semibold text-muted-foreground` | the heading over a `SideNav` link group (added after review m1 of PR 242) |
| `meta` | `text-sm text-muted-foreground` | hints and meta lines |

- `font-display` is on `pageTitle` and `sectionTitle` only: a decorative face in small titles hurts legibility. A fork that wants it on more
  roles edits `textStyles`, nothing else.
- Guard (`packages/theme/src/design-guard.spec.ts`, "heading roles"): every `<h1>` to `<h6>`, dynamic `<Heading>` and `<legend>` with a
  `className` in `packages/ui` and `apps/storefront` uses a `textStyles` role written inline (a call site adds layout, focus or visibility
  classes, or a prefixed size such as `md:text-4xl`; an unprefixed size, weight, family, colour or line height next to a role fails); a
  heading without classes, or with visibility classes only (`sr-only`, `lg:hidden`), passes. Spread props and dynamic tags not named
  `Heading` are not inspected. **Known limit:** `apps/admin` (71 headings) is
  not scanned yet. The text logo (`.fk-logo`, CSS) takes `font-display` through `@apply`.
- The header and footer shell carry no heading role with `font-display` (first-HTML budget, `shell.spec.tsx`); the registration page grew
  by 13 bytes (one `pageTitle`).

**Migration note for client forks (2026-11-09, additive: no token renamed or removed):** after merging, `pnpm --filter @fluxkit/theme test`
fails in a fork whose `packages/ui`, `apps/storefront` (including `@apply` in its CSS) or `apps/admin` use `rounded-sm|md|lg` outside the
exception list. Fix: use the role (`rounded-control|card|panel|overlay|media`; same pixels when the class was `rounded-md` on a control, an
inline panel or a picture, or `rounded-lg` on a card or dialog), or add a `radiusExceptions` entry with its count and a reason. A fork that changed `--fk-radius-md` or
`-lg` to rebrand also sets the role tokens (the template's components no longer read the steps, except the listed exceptions). A fork that
edited one of the 63 moved files gets a merge conflict on the class name only.

**Migration note for client forks (2026-11-08, additive):** a fork whose own headings in `packages/ui` or `apps/storefront` carry literal
typography classes fails the new guard after merging; replace the classes with a `textStyles` role (plus layout classes) or add a role.
A fork that edited `textStyles` gets one merge conflict in `packages/ui/src/styles.ts`: keep its own strings and take the new roles. No
raw-radius guard yet (role radii come in a later change).

**Migration note for client forks (2026-11-03, not a SemVer break: the tokens are additive):** after merging this upstream change, `pnpm test`
fails in a fork whose `packages/ui`, `apps/storefront` or `apps/admin` use a size, radius or shadow outside the scales (`text-5xl`,
`rounded-xl`, `shadow-md`, a bare `rounded` or `shadow`). Fix: replace the class with a scale step, or extend the scale in all three places:
a token in the light block of `tokens.css` (since 2026-11-08 non-colour tokens live only there), its mapping in `tailwind.css`, and the step list in `design-guard.spec.ts`.

## Fonts (2026-11-08, plan `docs/plans/2026-11-08-design-changeability.md` T1b)

- Template font (2026-11-14, plan `docs/plans/2026-11-14-playful-default-design.md`): template-owned `apps/storefront/src/lib/template-fonts.ts` loads Rubik (variable weight 300–900, SIL OFL 1.1; Cyrillic with Ґ Є І Ї, U+2019 and ₴) from `lib/fonts/`, as `--font-template-sans`. The root layout attaches template variables first, then the fork's `config/fonts.ts` variables. Both font modules are read as text in unit tests (Vitest has no Next font transform).
- Default body and display stack: `var(--font-template-sans, ui-sans-serif), system-ui, sans-serif`. The fallback INSIDE `var()` keeps the declaration valid in the admin, where Next's variable does not exist; a bare undefined variable invalidates the whole declaration.
- Fork replacement: its own `--fk-font-sans` and `--fk-font-display` in the light rule of `brand-overrides.css` win (same specificity, later file). It may drop the template face by naming no `--font-template-sans`; the font is then never downloaded because `preload: false`. Mail retains the internal fallback, while dropping a bare `var(--font-*)`.

- A font token may name a web font variable before its fallback stack: `--fk-font-display: var(--font-display-face), ui-sans-serif,
  system-ui, sans-serif;`. The variable comes from `next/font/local` in the storefront's fork-owned `apps/storefront/src/config/fonts.ts`
  (empty upstream; the root layout puts each font's `variable` class on `<html>`). `contrast.spec` reads colours only and the block parser
  accepts any value, so fonts need no hex; `email-theme.spec` compares `emailTheme.font` with the stack WITHOUT `var(--font-*)` entries
  (mail cannot load web fonts), so `--fk-font-sans` may also take a fork face without touching mail.
- A fork sets the font tokens in the light rule of its `packages/theme/src/brand-overrides.css` (see "Storefront overrides").
- A fork that changes `--fk-font-sans` but leaves `--fk-font-display` at the template stack fails `theme.spec.ts` (headings would silently
  stay in the system face): set both. The check reads the storefront's effective light values (tokens plus overrides).
- Admin: it imports the same `tokens.css` (`apps/admin/src/styles.css`) and follows `--fk-font-sans`; a web font for the admin needs its own
  `@font-face` (the admin has no `next/font`), declared in the fork-owned `packages/theme/src/admin-overrides.css` (see "Admin" below).
  Same rules as below.

- **Self-hosted woff2 only.** The CSP has no `font-src`, so `default-src 'self'` applies: same origin only (`next.config.ts`,
  `buildContentSecurityPolicy`). Google Fonts and other font CDNs are blocked on purpose (no third-party request, AGENTS.md 3); `next/font/google`
  is refused by `config/fonts.spec.ts`. Check the font's licence allows self-hosting on the web.
- Fallback metrics (`adjustFontFallback`, which writes a `size-adjust` fallback face), so text shows at once. Without a preload use
  `display: "optional"` (the template's Rubik does, 2026-11-14): with `swap` the face arrived after the first paint on a cold visit and
  re-wrapped text (layout shift 0.178 on the register page at 390 px; e2e `first-html` requires under 0.05). `optional` keeps the fallback
  for that view and uses the cached face on the next page.
- Coverage: Cyrillic including Ґ Є І Ї (and ґ є і ї), the apostrophe U+2019, ₴ and the Latin set; test with the shop's real copy in `uk`
  and `en`.
- Weights: load the ones `textStyles` uses (600 and 700 for headings, plus 500 for `cardTitle` if the body face is replaced) or one
  variable font; a missing weight is synthesised (fake bold).
- No preload (`preload: false`) while the first-HTML budget is open (plan 2026-11-08, L1): a preload `<link>` in `<head>` counts toward it.
- `@font-face` only in global CSS: `next/font` emits it into the root layout's stylesheet. Never declare a face (or a stylesheet that
  holds one) inside a `Suspense` boundary: a hoisted stylesheet there makes React outline the boundary.

## Admin (ADR 0047, 2026-11-08)

- The admin follows the shop by default (decision 1 of ADR 0047): `apps/admin/src/styles.css` imports `tokens.css`, `tailwind.css`, the
  shop's fork-owned `brand-overrides.css` and then `admin-overrides.css` (since PR-I2a, 2026-11-10), with `data-theme="light"` fixed. So a
  rebrand in `brand-overrides.css` reaches the admin through its light rule; its dark and system rules never match the admin's page (the
  built-CSS check allows the system media rule because it only matches `[data-theme=system]`). Effective admin values = `tokens.css` light
  block, then the light rule of `brand-overrides.css`, then `admin-overrides.css`.
- **Web fonts and the admin.** A bare `var(--font-...)` without an internal fallback in a font token of `brand-overrides.css` comes from `next/font` in the storefront and
  does not exist in the admin: there the whole `font-family` is invalid and the browser shows its default serif (Times New Roman), not the
  stack after the `var()`. `theme.spec.ts` fails in that case and names the token: restate that `--fk-font-*` in `admin-overrides.css`
  without the variable (the fallback stack, or a self-hosted `@font-face` there).
- **A neutral admin next to a rebranded shop:** restate in `admin-overrides.css` the template's value (from `tokens.css`, light block) of
  every token the shop overrides in its light rule (about 27 for the A1 rebrand: 15 colours, 8 radii, 3 shadows and the display face), or
  only the ones the admin should not take. A filled `brand-overrides.css` also adds its rules to the admin's CSS (measured with the A1
  fixture: +2,282 bytes raw, +356 gzip on a 28,939-byte stylesheet; the admin's JavaScript budget is not affected).
- `packages/theme/src/admin-overrides.css` (exported as `@fluxkit/theme/admin-overrides.css`) is **fork-owned**: empty upstream, never
  edited upstream after its creation, imported LAST by `apps/admin/src/styles.css`. No shipped source of the storefront, `packages/ui` or
  the other theme files may import or name it (tests may read it); `apps/admin/src/theme-isolation.spec.ts` checks this and the import
  order. It is additive: it overrides existing `--fk-*` tokens for the admin alone under `:root, [data-theme="light"]` (a later rule of
  equal specificity wins; a lower-specificity selector such as `html { ... }` loses to the `:root` block of `tokens.css`), and may hold a
  client `@font-face`. It must not add tokens the components do not read, nor a `[data-theme="dark"]`, `[data-theme="system"]` or
  `prefers-color-scheme` rule (a source check in any letter case and spacing, plus the built-CSS check; pattern checks, not a parser).
- The file's location and its import order are part of this contract; its content is the fork's. Since PR-I2a (2026-11-10) `contrast.spec.ts`
  checks the pairs of "Contrast" below on the admin's EFFECTIVE values (the light block of `tokens.css`, the light rule of `brand-overrides.css`,
  then this file; a `@font-face` rule is skipped), and `brand-overrides.spec.ts` checks its token values (6-digit hex colours, lengths,
  shadows, font lists, no `!important`), so a fork's admin colours are checked by CI (the ADR 0047 follow-up). Note for
  `apps/admin/README.md` (not edited in PR-I2a, a parallel change owns it): it says "a rebrand of `tokens.css` reaches the admin"; a rebrand
  in `brand-overrides.css` reaches it too.
- **Known limit:** the admin's headings (71) do not use `textStyles` roles and are not scanned by the heading-role guard; `font-display`
  does not reach them.
- The admin's name is in its messages (`app.name`, `app.documentTitle` in `apps/admin/src/messages/{uk,en}/common.json`), its favicon a
  fork-supplied `apps/admin/public/favicon.{svg,png,ico}` (`apps/admin/brand-html.ts`); neither is a token.

## Storefront overrides (PR-I2a, 2026-11-10, plan `docs/plans/2026-11-08-design-changeability.md` WP2)

- `packages/theme/src/brand-overrides.css` (exported as `@fluxkit/theme/brand-overrides.css`) is **fork-owned**: empty upstream (a comment
  with an example), never edited upstream after its creation. `apps/storefront/src/app/globals.css` imports it LAST, after `tokens.css` and
  `tailwind.css`; `apps/admin/src/styles.css` imports it too, after `tailwind.css` and before `admin-overrides.css` (see "Admin"). No other
  shipped source of the admin, `packages/ui` or the other theme files names it (tests may read it). `packages/theme/src/brand-overrides.spec.ts`
  checks the import order of both apps, the export and that scan.
- The file's location, its import order and the rules below are part of this contract (additive: no token renamed or removed); its content
  is the fork's.
- **Cascade.** It uses exactly the three rules of `tokens.css`, in their order: `:root, [data-theme="light"]`, then `[data-theme="dark"]`,
  then `@media (prefers-color-scheme: dark) { [data-theme="system"] { ... } }`. Every one of these selectors has the specificity of one
  pseudo-class or attribute (0,1,0), so the rule that comes later wins: the overrides beat `tokens.css` because they are imported after it.

  | Page | Rules that match, in order (the last one setting a token wins) |
  |---|---|
  | `light` or no attribute | tokens light, overrides light |
  | `dark` | tokens light, tokens dark, overrides light, overrides dark |
  | `system`, light device | tokens light, overrides light |
  | `system`, dark device | tokens light, tokens system, overrides light, overrides system |

  So a colour or shadow set in the overrides' light rule ALSO wins on dark pages unless the overrides' dark and system rules set it too.
  The rules: a colour or shadow set for light is also set for dark; the system rule holds exactly the dark rule's tokens and values;
  fonts, radii, the type scale and the spacing unit only in the light rule (all modes inherit them); existing `--fk-*` tokens only, 6-digit
  hex colours and valid values (lengths, shadows, font lists; an empty value fails), no `!important` (any spacing), no other selector (`html { ... }` would lose to `:root`, `html[data-theme="dark"]` would win by
  specificity; both are refused; a selector that differs only in spaces or quotes is told the exact spelling) and no other at-rule. Unlike
  `admin-overrides.css`, dark and system rules are allowed (the storefront renders all three modes). `brand-overrides.spec.ts` refuses
  everything else with a message naming the token or rule; a parse error names the overrides file.
- **Checks on the effective values.** `effectiveTokens` (`packages/theme/src/token-blocks.ts`) applies the matching rules of `tokens.css`
  and the overrides in this order for each page state. `contrast.spec.ts` (every pair below, the four page states of the table),
  `theme.spec.ts` (display font), `email-theme.spec.ts` and `theme-color.spec.ts` read these effective values.
- **Two literal copies a rebrand still edits by hand** (upstream files; mail and the `theme-color` meta cannot read CSS variables):
  `packages/theme/src/email-theme.ts` (the light colours, font stacks and scale radii in px) and `packages/theme/src/theme-color.ts` (the
  light and dark `--fk-color-background`). Their specs fail until they equal the effective values and print the literals to write. The
  `EmailTheme` interface of `@fluxkit/core` is unchanged. Generating them from the CSS was not chosen: it needs a build step that runs
  before every consumer of `@fluxkit/theme` (API, storefront, specs) for two small objects.
- **Fork run.** `packages/theme/vitest.brand-fork.config.ts` (part of `pnpm --filter @fluxkit/theme test`) runs the theme specs once more
  with filled fixtures in `packages/theme/src/fork-fixture/`: the A1 "Verde Kopi" palette, radii, shadows and a `var(--font-...)` display
  face as storefront overrides, an admin that follows them with a neutral primary and a client font (the display face restated), and the
  updated literal copies. `fork-run.spec.ts` is its canary. It reads the fork's own `tokens.css` under the fixtures: green for a fork that
  rebrands in `brand-overrides.css` as documented; in that run a literal-copy failure names the fixture file it compared, so a fork that
  still edits `tokens.css` sees which file the message is about. The upstream-only
  `packages/theme/src/brand-overrides.upstream.spec.ts` pins the empty upstream file; a fork that fills the file deletes it.

**Migration note for client forks (2026-11-10, additive: no token renamed or removed):** a fork that rebranded by editing `tokens.css` may
keep doing so, but every upstream change of `tokens.css` then conflicts. To move: put the changed values into
`packages/theme/src/brand-overrides.css` under the three rules above (colours and shadows in all three, everything else in light), reset
`tokens.css` to upstream's, and run `pnpm --filter @fluxkit/theme test`. The admin follows the light rule as it followed `tokens.css`; a
fork whose admin overrides restated template values for a neutral admin keeps them, and a font token with `var(--font-...)` is restated
there (see "Admin").

## Themes and modes (design batch B, 2026-11-03)

`data-theme` on `<html>` selects the theme; `tokens.css` has three theme blocks plus the checked reduced-motion block (a test refuses any other rule):

| `data-theme` | Block | `color-scheme` | Who sets it |
|---|---|---|---|
| none or `light` | `:root, [data-theme="light"]` (every token) | `light` | the admin (`index.html`, fixed); the storefront when the shopper or the config chose light |
| `dark` | `[data-theme="dark"]` (colours and shadows only, the same names as light's; everything else is inherited from `:root`) | `dark` | the storefront |
| `system` | light, plus `@media (prefers-color-scheme: dark) { [data-theme="system"] { ... } }` on a dark device | `dark` there | the storefront (default) |

- Fonts, radii, motion, the type scale and the spacing unit are defined once, in the light block (single definition since 2026-11-08, plan
  `docs/plans/2026-11-08-design-changeability.md` T4): the dark block holds only `--fk-color-*` and `--fk-shadow-*`, exactly the names of
  light's colours and shadows. The `system` block is a byte-for-byte copy of the dark block. `packages/theme/src/theme.spec.ts` enforces all
  three rules and that every `var(--fk-*)` in `tailwind.css` is defined in the light block. It is **opt-in**: no rule under the media query matches `:root`, so a page without
  `data-theme="system"` (the admin) never follows the device (`apps/admin/src/theme-isolation.spec.ts` checks the admin's built CSS).
- `color-scheme` makes native controls and select popups follow the theme, and scrollbars where an app sets no `scrollbar-color`. The storefront
  colours its thin scrollbars from existing tokens (`border-input` thumb on a `background` track, a pair the contrast test holds to 3:1;
  `apps/storefront/src/app/globals.css`); the admin keeps the native ones.
- Mail stays light (`emailTheme` holds the storefront's effective light values; mail templates set `color-scheme: light`).
- `@fluxkit/theme` exports `themeModes` (`light`, `dark`, `system`) and the type `ThemeMode` (additive).
- The storefront's choice of mode: `apps/storefront/src/config/theme.ts` (`defaultMode`, `showToggle`) and the `fluxkit_theme` cookie
  (ADR 0045); the server renders `data-theme`, so the first paint is right without a script.

**How a fork rebrands both themes:** in `packages/theme/src/brand-overrides.css` (see "Storefront overrides"), set the light values in the
`:root, [data-theme="light"]` rule (fonts, radii and sizes only there) and the dark colours and shadows in the `[data-theme="dark"]` rule (the
same names; the contrast pairs below must pass in every mode), then copy the dark rule into the `system` rule: `pnpm --filter
@fluxkit/theme test` names each token that is missing or different there. A shop without a dark theme sets `defaultMode: "light"` and
`showToggle: false` in the storefront config (the dark blocks then never apply). No component edits.

**Migration note for client forks (2026-11-08, additive: no token renamed or removed):** the non-colour tokens left the dark block. A fork
that changed a font, radius, size or the spacing unit in BOTH blocks keeps its light value and deletes the dark copy (`pnpm --filter
@fluxkit/theme test` names each repeat); a fork that set a different value only in dark loses it (dark now inherits from `:root`).

**Migration note for client forks (2026-11-03, additive: no token renamed or removed):** a fork that changed dark values in `tokens.css` must
copy them into the new `system` block (the test above fails until it does). The storefront now renders `data-theme="system"` by default
instead of `light`: a fork whose components assumed the light theme only (for example a picture without its own background) checks them in
dark, or sets `defaultMode: "light"`.

## Contrast (enforced by `packages/theme/src/contrast.spec.ts`)

The test parses `tokens.css` and the overrides files into their blocks (`packages/theme/src/token-blocks.ts`; 6-digit hex values only; another color format fails the test) and computes the WCAG 2.x contrast ratio on the EFFECTIVE values (since 2026-11-10): the storefront's `tokens.css` plus `brand-overrides.css` in light, dark and the system mode on a light and on a dark device, and the admin's `tokens.css`, the light rule of `brand-overrides.css` and `admin-overrides.css` in light. A rebrand must keep these pairs passing:

| Foreground on background | Minimum |
|---|---|
| `foreground` on `background` | 4.5:1 |
| `primary-foreground` on `primary` | 4.5:1 |
| `danger-foreground` on `danger` | 4.5:1 (the cart count badge) |
| `muted-foreground` on `muted` | 4.5:1 |
| `danger` on `background` | 4.5:1 |
| `success` on `background` | 4.5:1 |
| `warning` on `background` | 4.5:1 |
| `ring` on `background` | 3:1 (non-text, WCAG 1.4.11) |
| `muted-foreground` on `background` | 4.5:1 (hints and secondary text) |
| `foreground` on `muted` | 4.5:1 (alert text) |
| `ring` on `muted` | 3:1 (focus inside an alert) |
| `primary` on `background` and on `muted` | 3:1 (info alert border) |
| `border-input` on `background` and on `muted` | 3:1 (non-text, WCAG 1.4.11: the border that identifies a text control; `muted` is the alert surface) |
| `accent-foreground` on `accent` | 4.5:1 (the banner `accent` tone; checked unconditionally, also while no component uses it) |
| `accent` on `background` and on `muted` | 3:1 (an accent surface or border next to the page or a muted surface; unconditional) |

**Three different "accent"s (2026-11-08):** the banner tone NAME `accent` (stored by the API in `banner.tone`, kept for compatibility),
the colour TOKEN `--fk-color-accent` that tone uses (`bg-accent text-accent-foreground`; before 2026-11-08 the tone used the primary
classes, with the same pixels), and Tailwind's own `accent-*` utilities, which set the CSS `accent-color` of checkboxes and radios
(`accent-primary` in `Checkbox` stays as it is). A fork sets the accent pair in all three theme blocks; the pairs above must pass.

The test also reads the class strings of `packages/ui` and `apps/storefront` and fails when a component uses a text, border, outline or ring token on a background that is neither in this table nor declared decorative in the test (`border` on `background` and on `muted`: outlines of cards, badges, buttons and dividers, whose content is identified by its text).

Design batch B (2026-11-03) added no colour token and no new pair either: the hero and the category tiles are `foreground` and
`muted-foreground` on `muted`, the theme switch `primary-foreground` on `primary` (pressed) and `foreground` on `background`/`muted`. The storefront
e2e (`e2e/tests/design-b.e2e.ts`) also measures the computed colours of every visible text and text-field border of the home, product, category,
cart and checkout pages in dark (4.5:1 text, 3:1 field border).

Design batch A (2026-11-03) added no colour token and no new pair: the discount badge is `danger-foreground` on `danger`, the current funnel step
`primary-foreground` on `primary`, the hovered card border `border-input` on `background`, the trust bar `foreground` and `muted-foreground` on
`background`; all are in the table above and the class scan confirms it.

Status colors (`danger`, `success`, `warning`) are documented and tested for text on `background` and on `muted` (4.5:1 in both themes). The light `danger` was darkened from `#dc2626` to `#b91c1c` (4.41:1 on `muted` before). The `Alert` uses the status colors for borders only.

## Email theme (`emailTheme`, ADR 0031 decision 14)

Status: contract since email plan step 2 (ADR 0031 open question 7: it joins this contract because its values follow the tokens). Renaming or removing a member is a breaking change; adding one is additive.

Mail clients do not support CSS variables, so mail templates (`EmailTemplate`, `docs/contracts/email-templates.md`) style inline with `emailTheme` from `@fluxkit/theme`; its shape is the `EmailTheme` interface of `@fluxkit/core`.

| Member | Source | Value today |
|---|---|---|
| `color.background`, `foreground`, `muted`, `mutedForeground`, `border`, `primary`, `primaryForeground`, `danger`, `success`, `warning` | the light value of `--fk-color-<kebab name>` | 6-digit hex |
| `font.sans`, `font.mono` | `--fk-font-sans`, `--fk-font-mono` with bare `var(--font-*)` entries stripped and internal `var()` fallbacks retained | the token stacks |
| `radius.sm`, `md`, `lg` | `--fk-radius-*`, rem to px (16px per rem) | `6px`, `12px`, `24px` |
| `space.xs` to `space.xl` | mail only | `4px`, `8px`, `16px`, `24px`, `32px` |
| `fontSize.small`, `body`, `heading` | mail only | `13px`, `15px`, `20px` |
| `lineHeight` | mail only | `1.5` |
| `contentWidth` | mail only (pixels, the content table's `width`) | `600` |

Not used in mail: `--fk-motion-*` (mail has no transitions or animations), `--fk-color-border-input` (no form controls), `--fk-color-danger-foreground` (no text on a danger fill), `--fk-color-accent` and `-accent-foreground` (no banner or other accent surface in mail; 2026-11-08), `--fk-font-display` (mail headings use `font.sans`; a fork's display face is a web font mail cannot load; 2026-11-08), `--fk-color-ring` (no keyboard focus), `--fk-shadow-card`, `--fk-shadow-raised`, `--fk-shadow-overlay` (box-shadow is poorly supported), `--fk-font-size-*`, `--fk-line-height-*` and `--fk-space-unit` (mail keeps its own px groups `fontSize`, `lineHeight`, `space`). Dark mode is not attempted in mail.
`packages/theme/src/email-theme.spec.ts` fails when a color, font or radius differs from its light token (fonts retain internal `var()` fallbacks and drop bare `var(--font-*)` entries, since mail cannot load a web font) or when a light token is neither in `emailTheme` nor in that list. Rebranding mail = changing `tokens.css` and the matching `emailTheme` values (the guard names each one), never a template.

## Motion (2026-11-14)

Additive contract (minor); no existing token is renamed or removed.

| Token | Default | Purpose / Tailwind utility |
|---|---|---|
| `--fk-motion-duration-fast` | `150ms` | hover/press feedback; `duration-fast` |
| `--fk-motion-duration-base` | `250ms` | toasts, popovers, number roll; `duration-base` |
| `--fk-motion-duration-slow` | `400ms` | drawers, page reveals; `duration-slow` |
| `--fk-motion-ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | existing Tailwind timing; `ease-standard` |
| `--fk-motion-ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | settling reveals; `ease-emphasized` |
| `--fk-motion-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | pop-in and drawer overshoot; `ease-spring` |

- Define/retune motion tokens only in the light rule of `brand-overrides.css`; dark and system inherit them.
- Plain `transition*` utilities use the fast duration and standard easing through `--default-transition-duration` and `--default-transition-timing-function`. Duration utilities set both `--tw-duration` and `transition-duration`, like Tailwind's own duration utility.
- `@media (prefers-reduced-motion: reduce) { html:root { ... } }` zeroes exactly the three durations (`0ms`), leaves easings intact, and beats fork override selectors by specificity (0,1,1 over 0,1,0), whatever their import order.
- Code waiting for `transitionend` / `animationend` must not rely on the event under reduced motion: a 0ms transition fires no event. Motion must not block input.
- Guards refuse numeric `duration-<n>`, arbitrary duration/ease/delay classes and built-in ease-in/out/in-out/linear classes. Raw milliseconds in storefront `globals.css` belong to the separate motion workstream.
