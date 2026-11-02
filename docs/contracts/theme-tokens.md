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
| `--fk-color-danger` | `text-danger`, `bg-danger`, `border-danger` | destructive and error states |
| `--fk-color-danger-foreground` | `text-danger-foreground` | text on a `danger` fill, such as the header's cart count badge (added 2026-11-02) |
| `--fk-color-success` | `text-success`, `border-success` | success and availability (added in storefront plan step 4a) |
| `--fk-color-warning` | `text-warning`, `border-warning` | notices such as changed prices (added in step 4a) |
| `--fk-color-ring` | `outline-ring`, `ring-ring` | visible keyboard focus (added in step 4a) |
| `--fk-radius-sm` / `-md` / `-lg` | `rounded-sm` / `rounded-md` / `rounded-lg` | corner radii |
| `--fk-font-sans` / `-mono` | `font-sans` / `font-mono` | font stacks |
| `--fk-shadow-card` | `shadow-card` | card elevation (resting) |
| `--fk-shadow-raised` | `shadow-raised` | a raised surface: the hovered product card (added 2026-11-03, design batch A) |
| `--fk-shadow-overlay` | `shadow-overlay` | surfaces over the page: menus, toasts, bars (added 2026-11-03) |
| `--fk-font-size-{xs,sm,base,lg,xl,2xl,3xl,4xl}` / `--fk-line-height-{same steps}` | `text-xs` ... `text-4xl` (size and line height) | the type scale (added 2026-11-03; values = Tailwind's defaults, so nothing moved) |
| `--fk-space-unit` | every spacing utility (`p-4` = 4 units, `gap-2`, `m-6`, `size-11`, ...) | the spacing unit, 0.25rem (added 2026-11-03) |

Design kit rules (review D-19, plan `docs/plans/2026-11-03-storefront-design-a.md`; enforced by `packages/theme/src/design-guard.spec.ts`): font sizes only
`text-xs` to `text-4xl`, radii only `rounded-sm|md|lg` (plus the shape `rounded-full` and `rounded-none`), shadows only `shadow-card|raised|overlay|none`; a
step outside a scale (`text-5xl`, `rounded-xl`, `shadow-md`) would use a Tailwind built-in value that a rebrand of `tokens.css` cannot reach. Text roles
(page title, section title, subsection title, meta) are class strings in `@fluxkit/ui` (`textStyles`), built from these tokens. Names are roles, not looks,
so a dark theme only sets values. Controls have no colour transition: it would also animate `outline-color`, so the focus ring would fade in.

**Migration note for client forks (2026-11-03, not a SemVer break: the tokens are additive):** after merging this upstream change, `pnpm test`
fails in a fork whose `packages/ui`, `apps/storefront` or `apps/admin` use a size, radius or shadow outside the scales (`text-5xl`,
`rounded-xl`, `shadow-md`, a bare `rounded` or `shadow`). Fix: replace the class with a scale step, or extend the scale in all three places:
a token in both theme blocks of `tokens.css`, its mapping in `tailwind.css`, and the step list in `design-guard.spec.ts`.

## Themes and modes (design batch B, 2026-11-03)

`data-theme` on `<html>` selects the theme; `tokens.css` has exactly three blocks (a test refuses any other rule):

| `data-theme` | Block | `color-scheme` | Who sets it |
|---|---|---|---|
| none or `light` | `:root, [data-theme="light"]` (every token) | `light` | the admin (`index.html`, fixed); the storefront when the shopper or the config chose light |
| `dark` | `[data-theme="dark"]` (every token, same names) | `dark` | the storefront |
| `system` | light, plus `@media (prefers-color-scheme: dark) { [data-theme="system"] { ... } }` on a dark device | `dark` there | the storefront (default) |

- The `system` block holds the dark value of every token whose dark value differs from light (today: all colours and the three shadows) and
  nothing else; a test keeps it equal to the dark block. It is **opt-in**: no rule under the media query matches `:root`, so a page without
  `data-theme="system"` (the admin) never follows the device (`apps/admin/src/theme-isolation.spec.ts` checks the admin's built CSS).
- `color-scheme` makes native controls, scrollbars and select popups follow the theme.
- Mail stays light (`emailTheme` reads the light block; mail templates set `color-scheme: light`).
- `@fluxkit/theme` exports `themeModes` (`light`, `dark`, `system`) and the type `ThemeMode` (additive).
- The storefront's choice of mode: `apps/storefront/src/config/theme.ts` (`defaultMode`, `showToggle`) and the `fluxkit_theme` cookie
  (ADR 0045); the server renders `data-theme`, so the first paint is right without a script.

**How a fork rebrands both themes:** set the light values in the `:root` block and the dark values in the `[data-theme="dark"]` block (same names;
the contrast pairs below must pass in both), then copy every dark value that differs from light into the `system` block: `pnpm --filter
@fluxkit/theme test` names each token that is missing or different there. A shop without a dark theme sets `defaultMode: "light"` and
`showToggle: false` in the storefront config (the dark blocks then never apply). No component edits.

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
| `font.sans`, `font.mono` | `--fk-font-sans`, `--fk-font-mono` | the token stacks |
| `radius.sm`, `md`, `lg` | `--fk-radius-*`, rem to px (16px per rem) | `4px`, `8px`, `16px` |
| `space.xs` to `space.xl` | mail only | `4px`, `8px`, `16px`, `24px`, `32px` |
| `fontSize.small`, `body`, `heading` | mail only | `13px`, `15px`, `20px` |
| `lineHeight` | mail only | `1.5` |
| `contentWidth` | mail only (pixels, the content table's `width`) | `600` |

Not used in mail: `--fk-color-border-input` (no form controls), `--fk-color-danger-foreground` (no text on a danger fill), `--fk-color-ring` (no keyboard focus), `--fk-shadow-card`, `--fk-shadow-raised`, `--fk-shadow-overlay` (box-shadow is poorly supported), `--fk-font-size-*`, `--fk-line-height-*` and `--fk-space-unit` (mail keeps its own px groups `fontSize`, `lineHeight`, `space`). Dark mode is not attempted in mail.
`packages/theme/src/email-theme.spec.ts` fails when a color, font or radius differs from its light token or when a light token is neither in `emailTheme` nor in that list. Rebranding mail = changing `tokens.css` and the matching `emailTheme` values (the guard names each one), never a template.
