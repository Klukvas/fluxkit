# Contract: design tokens

Status: draft (introduced in plan step 7). Covered by SemVer; renaming or removing a token is a breaking change.

Source of truth: `packages/theme/src/tokens.css`. Components use semantic Tailwind utilities mapped in `packages/theme/src/tailwind.css`; never raw values.

| Token | Tailwind utility | Purpose |
|---|---|---|
| `--fk-color-background` / `-foreground` | `bg-background` / `text-foreground` | page background and text |
| `--fk-color-muted` / `-muted-foreground` | `bg-muted` / `text-muted-foreground` | secondary surfaces and text |
| `--fk-color-border` | `border-border` | borders and dividers |
| `--fk-color-primary` / `-primary-foreground` | `bg-primary` / `text-primary-foreground` | primary actions |
| `--fk-color-danger` | `text-danger`, `bg-danger` | destructive and error states |
| `--fk-radius-sm` / `-md` / `-lg` | `rounded-sm` / `rounded-md` / `rounded-lg` | corner radii |
| `--fk-font-sans` / `-mono` | `font-sans` / `font-mono` | font stacks |
| `--fk-shadow-card` | `shadow-card` | card elevation |

Themes: `light` (default) and `dark`, selected with `data-theme` on `<html>`. Both define exactly the same token names (enforced by a test).
Rebranding a client = changing values in `tokens.css` (or adding a preset block); no component edits.
