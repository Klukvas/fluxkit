# packages/theme

- `src/tokens.css` - the design tokens for the `light` and `dark` themes (the one place to rebrand).
- `src/tailwind.css` - maps tokens to Tailwind semantic utilities.
- `src/index.ts` - theme names and default.
- `src/theme.spec.ts` - tokens are identical across themes and every mapped token exists.
- `src/design-guard.spec.ts` - fails if `packages/ui`, `apps/storefront` or `apps/admin` contain hex/rgb colors, Tailwind palette colors, arbitrary values or inline styles.
