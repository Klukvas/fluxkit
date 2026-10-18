# Contract: design tokens

Status: draft (introduced in plan step 7). Covered by SemVer; renaming or removing a token is a breaking change. Adding a token is additive (minor).

Source of truth: `packages/theme/src/tokens.css`. Components use semantic Tailwind utilities mapped in `packages/theme/src/tailwind.css`; never raw values.

| Token | Tailwind utility | Purpose |
|---|---|---|
| `--fk-color-background` / `-foreground` | `bg-background` / `text-foreground` | page background and text |
| `--fk-color-muted` / `-muted-foreground` | `bg-muted` / `text-muted-foreground` | secondary surfaces and text |
| `--fk-color-border` | `border-border` | borders and dividers |
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

Status colors (`danger`, `success`, `warning`) are documented for text on `background`. Known gap: in the light theme `danger` reaches only 4.41:1 on `muted` (below 4.5:1; `success` and `warning` reach 4.58:1), so error text must not sit on `muted` surfaces (for example `Card`) until the light `danger` value is darkened, which is a contract-visible change left to the owner. The `Alert` uses the status colors for borders only.
