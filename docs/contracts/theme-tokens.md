# Contract: design tokens

Status: draft (introduced in plan step 7). Covered by SemVer; renaming or removing a token is a breaking change. Adding a token is additive (minor).

Source of truth: `packages/theme/src/tokens.css`. Components use semantic Tailwind utilities mapped in `packages/theme/src/tailwind.css`; never raw values.

| Token | Tailwind utility | Purpose |
|---|---|---|
| `--fk-color-background` / `-foreground` | `bg-background` / `text-foreground` | page background and text |
| `--fk-color-muted` / `-muted-foreground` | `bg-muted` / `text-muted-foreground` | secondary surfaces and text |
| `--fk-color-border` | `border-border` | decorative borders and dividers (cards, badges, buttons); about 1.2:1, NOT for the line that identifies a control |
| `--fk-color-border-input` | `border-border-input` | the border of inputs, textareas, selects and checkboxes (WCAG 1.4.11, at least 3:1; added after the storefront step 10 review) |
| `--fk-color-primary` / `-primary-foreground` | `bg-primary` / `text-primary-foreground` | primary actions |
| `--fk-color-accent` / `-accent-foreground` | `bg-accent`, `border-accent` / `text-accent-foreground` | a second brand colour: the `accent` tone of a home banner card (`BannerCard`), otherwise **reserved for client code**. Defaults equal the primary pair (6-digit hex copies, not `var()`), so nothing moved. Added 2026-11-08 |
| `--fk-color-danger` | `text-danger`, `bg-danger`, `border-danger` | destructive and error states |
| `--fk-color-danger-foreground` | `text-danger-foreground` | text on a `danger` fill, such as the header's cart count badge (added 2026-11-02) |
| `--fk-color-success` | `text-success`, `border-success` | success and availability (added in storefront plan step 4a) |
| `--fk-color-warning` | `text-warning`, `border-warning` | notices such as changed prices (added in step 4a) |
| `--fk-color-ring` | `outline-ring`, `ring-ring` | visible keyboard focus (added in step 4a) |
| `--fk-radius-sm` / `-md` / `-lg` | `rounded-sm` / `rounded-md` / `rounded-lg` | the radius size steps. Kept for forks' own components (additive); the template's code uses the role radii below and these steps only through the guard's exception list |
| `--fk-radius-control` | `rounded-control` | buttons, fields, selects, chips, pagination, menu entries and header links, focus targets (a focused section's outline), and popups anchored to a field (menus, suggestion and combobox lists, the search hint). Default `0.5rem`. Added 2026-11-09 |
| `--fk-radius-card` | `rounded-card` | product, banner and order cards (and their skeletons), `Card`, the hero, large admin preview frames. Default `1rem`. Added 2026-11-09 |
| `--fk-radius-panel` | `rounded-panel` | inline panels inside a page: notices, empty-result boxes, `Alert`, the `TrustBar` items, the `DataTable` scroll hint, admin sections and fieldsets. Default `0.5rem`. Added 2026-11-09 (owner decision on the review of PR 246) |
| `--fk-radius-overlay` | `rounded-overlay` | free-floating surfaces over the page: `Dialog`, the add-to-cart toast. Default `1rem`. Added 2026-11-09 |
| `--fk-radius-media` | `rounded-media` | product and banner pictures, gallery thumbnails, `ProductImage`, `StoreImage`, `Skeleton` (it stands in for loading content). Default `0.5rem`. Added 2026-11-09 |
| `--fk-font-sans` / `-mono` | `font-sans` / `font-mono` | font stacks |
| `--fk-font-display` | `font-display` | the heading face of the `pageTitle` and `sectionTitle` roles and the text logo (`.fk-logo`); default = the `--fk-font-sans` stack, so nothing moved (a test asserts the equality). May be `var(--font-...)` from `apps/storefront/src/config/fonts.ts` (section "Fonts"). Added 2026-11-08 |
| `--fk-shadow-card` | `shadow-card` | card elevation (resting) |
| `--fk-shadow-raised` | `shadow-raised` | a raised surface: the hovered product card (added 2026-11-03, design batch A) |
| `--fk-shadow-overlay` | `shadow-overlay` | surfaces over the page: menus, toasts, bars (added 2026-11-03) |
| `--fk-font-size-{xs,sm,base,lg,xl,2xl,3xl,4xl}` / `--fk-line-height-{same steps}` | `text-xs` ... `text-4xl` (size and line height) | the type scale (added 2026-11-03; values = Tailwind's defaults, so nothing moved) |
| `--fk-space-unit` | every spacing utility (`p-4` = 4 units, `gap-2`, `m-6`, `size-11`, ...) | the spacing unit, 0.25rem (added 2026-11-03) |

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
  count and reason):** the 0.25rem parts have no role (owner decision 2026-11-09) and keep `rounded-sm`: `Checkbox`, `Badge`, the discount
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
  - Admin search status: each per-language `LocaleCard` (`apps/admin/src/areas/search/search-status-view.tsx`) is `card` (it was
    `rounded-lg`, 1rem: a repeated card in a list, like order cards), while the admin's sections and fieldsets that were `rounded-md` are all
    `panel`. Making the `LocaleCard` a panel would be a visual change (1rem to 0.5rem) and was not made.

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

- A font token may name a web font variable before its fallback stack: `--fk-font-display: var(--font-display-face), ui-sans-serif,
  system-ui, sans-serif;`. The variable comes from `next/font/local` in the storefront's fork-owned `apps/storefront/src/config/fonts.ts`
  (empty upstream; the root layout puts each font's `variable` class on `<html>`). `contrast.spec` reads colours only and the block parser
  accepts any value, so fonts need no hex; `email-theme.spec` compares `emailTheme.font` with the stack WITHOUT `var(--font-*)` entries
  (mail cannot load web fonts), so `--fk-font-sans` may also take a fork face without touching mail.
- A fork that changes `--fk-font-sans` but leaves `--fk-font-display` at the template stack fails `theme.spec.ts` (headings would silently
  stay in the system face): set both.
- Admin: it imports the same `tokens.css` (`apps/admin/src/styles.css`) and follows `--fk-font-sans`; a web font for the admin needs its own
  `@font-face` (the admin has no `next/font`). Its place is the admin overrides file planned for a later change (plan, B2/E1); until then a
  fork declares it in `apps/admin/src/styles.css`. Same rules as below.

- **Self-hosted woff2 only.** The CSP has no `font-src`, so `default-src 'self'` applies: same origin only (`next.config.ts`,
  `buildContentSecurityPolicy`). Google Fonts and other font CDNs are blocked on purpose (no third-party request, AGENTS.md 3); `next/font/google`
  is refused by `config/fonts.spec.ts`. Check the font's licence allows self-hosting on the web.
- `display: "swap"` with fallback metrics (`adjustFontFallback`, which writes a `size-adjust` fallback face), so text shows at once and
  barely moves when the face arrives.
- Coverage: Cyrillic including Ґ Є І Ї (and ґ є і ї), the apostrophe U+2019, ₴ and the Latin set; test with the shop's real copy in `uk`
  and `en`.
- Weights: load the ones `textStyles` uses (600 and 700 for headings, plus 500 for `cardTitle` if the body face is replaced) or one
  variable font; a missing weight is synthesised (fake bold).
- No preload (`preload: false`) while the first-HTML budget is open (plan 2026-11-08, L1): a preload `<link>` in `<head>` counts toward it.
- `@font-face` only in global CSS: `next/font` emits it into the root layout's stylesheet. Never declare a face (or a stylesheet that
  holds one) inside a `Suspense` boundary: a hoisted stylesheet there makes React outline the boundary.

## Themes and modes (design batch B, 2026-11-03)

`data-theme` on `<html>` selects the theme; `tokens.css` has exactly three blocks (a test refuses any other rule):

| `data-theme` | Block | `color-scheme` | Who sets it |
|---|---|---|---|
| none or `light` | `:root, [data-theme="light"]` (every token) | `light` | the admin (`index.html`, fixed); the storefront when the shopper or the config chose light |
| `dark` | `[data-theme="dark"]` (colours and shadows only, the same names as light's; everything else is inherited from `:root`) | `dark` | the storefront |
| `system` | light, plus `@media (prefers-color-scheme: dark) { [data-theme="system"] { ... } }` on a dark device | `dark` there | the storefront (default) |

- Fonts, radii, the type scale and the spacing unit are defined once, in the light block (single definition since 2026-11-08, plan
  `docs/plans/2026-11-08-design-changeability.md` T4): the dark block holds only `--fk-color-*` and `--fk-shadow-*`, exactly the names of
  light's colours and shadows. The `system` block is a byte-for-byte copy of the dark block. `packages/theme/src/theme.spec.ts` enforces all
  three rules and that every `var(--fk-*)` in `tailwind.css` is defined in the light block. It is **opt-in**: no rule under the media query matches `:root`, so a page without
  `data-theme="system"` (the admin) never follows the device (`apps/admin/src/theme-isolation.spec.ts` checks the admin's built CSS).
- `color-scheme` makes native controls, scrollbars and select popups follow the theme.
- Mail stays light (`emailTheme` reads the light block; mail templates set `color-scheme: light`).
- `@fluxkit/theme` exports `themeModes` (`light`, `dark`, `system`) and the type `ThemeMode` (additive).
- The storefront's choice of mode: `apps/storefront/src/config/theme.ts` (`defaultMode`, `showToggle`) and the `fluxkit_theme` cookie
  (ADR 0045); the server renders `data-theme`, so the first paint is right without a script.

**How a fork rebrands both themes:** set the light values in the `:root` block (fonts, radii and sizes only there) and the dark colours and
shadows in the `[data-theme="dark"]` block (same names; the contrast pairs below must pass in both), then copy the dark block into the `system` block: `pnpm --filter
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

The test parses `tokens.css` into its blocks (`packages/theme/src/token-blocks.ts`; 6-digit hex values only; another color format fails the test) and computes the WCAG 2.x contrast ratio in the light theme, the dark theme and the system mode on a dark device (light values overridden by the system block). A rebrand must keep these pairs passing:

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
| `font.sans`, `font.mono` | `--fk-font-sans`, `--fk-font-mono` with every `var(--font-*)` entry (a fork's web font) stripped | the token stacks |
| `radius.sm`, `md`, `lg` | `--fk-radius-*`, rem to px (16px per rem) | `4px`, `8px`, `16px` |
| `space.xs` to `space.xl` | mail only | `4px`, `8px`, `16px`, `24px`, `32px` |
| `fontSize.small`, `body`, `heading` | mail only | `13px`, `15px`, `20px` |
| `lineHeight` | mail only | `1.5` |
| `contentWidth` | mail only (pixels, the content table's `width`) | `600` |

Not used in mail: `--fk-color-border-input` (no form controls), `--fk-color-danger-foreground` (no text on a danger fill), `--fk-color-accent` and `-accent-foreground` (no banner or other accent surface in mail; 2026-11-08), `--fk-font-display` (mail headings use `font.sans`; a fork's display face is a web font mail cannot load; 2026-11-08), `--fk-color-ring` (no keyboard focus), `--fk-shadow-card`, `--fk-shadow-raised`, `--fk-shadow-overlay` (box-shadow is poorly supported), `--fk-font-size-*`, `--fk-line-height-*` and `--fk-space-unit` (mail keeps its own px groups `fontSize`, `lineHeight`, `space`). Dark mode is not attempted in mail.
`packages/theme/src/email-theme.spec.ts` fails when a color, font or radius differs from its light token (fonts are compared after stripping `var(--font-*)` entries, since mail cannot load a web font) or when a light token is neither in `emailTheme` nor in that list. Rebranding mail = changing `tokens.css` and the matching `emailTheme` values (the guard names each one), never a template.
