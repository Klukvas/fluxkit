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
| `--fk-color-success` | `text-success`, `border-success` | success and availability (added in storefront plan step 4a) |
| `--fk-color-warning` | `text-warning`, `border-warning` | notices such as changed prices (added in step 4a) |
| `--fk-color-ring` | `outline-ring`, `ring-ring` | visible keyboard focus (added in step 4a) |
| `--fk-radius-sm` / `-md` / `-lg` | `rounded-sm` / `rounded-md` / `rounded-lg` | corner radii |
| `--fk-font-sans` / `-mono` | `font-sans` / `font-mono` | font stacks |
| `--fk-shadow-card` | `shadow-card` | card elevation |

Themes: `light` (default) and `dark`, selected with `data-theme` on `<html>`. Both define exactly the same token names (enforced by a test).
Rebranding a client = changing values in `tokens.css` (or adding a preset block); no component edits.

## Contrast (enforced by `packages/theme/src/contrast.spec.ts`)

The test parses `tokens.css` (6-digit hex values only; another color format fails the test) and computes the WCAG 2.x contrast ratio in both themes. A rebrand must keep these pairs passing:

| Foreground on background | Minimum |
|---|---|
| `foreground` on `background` | 4.5:1 |
| `primary-foreground` on `primary` | 4.5:1 |
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

Not used in mail: `--fk-color-border-input` (no form controls), `--fk-color-ring` (no keyboard focus), `--fk-shadow-card` (box-shadow is poorly supported). Dark mode is not attempted in mail.
`packages/theme/src/email-theme.spec.ts` fails when a color, font or radius differs from its light token or when a light token is neither in `emailTheme` nor in that list. Rebranding mail = changing `tokens.css` and the matching `emailTheme` values (the guard names each one), never a template.
