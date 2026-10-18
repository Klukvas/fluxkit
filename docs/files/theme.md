# packages/theme

- `src/tokens.css` - the design tokens for the `light` and `dark` themes (the one place to rebrand). Colors are 6-digit hex (the contrast test requires it).
- `src/tailwind.css` - maps tokens to Tailwind semantic utilities (`success`, `warning` and `ring` included).
- `src/index.ts` - theme names and default.
- `src/theme.spec.ts` - tokens are identical across themes, every mapped token exists, every color token is mapped.
- `src/contrast.spec.ts` - WCAG 2.x contrast of the documented token pairs in both themes (`docs/contracts/theme-tokens.md`).
- `src/design-guard.spec.ts` - fails if `packages/ui`, `apps/storefront` or `apps/admin` contain hex/rgb colors, Tailwind palette colors, color utilities that are not token names, arbitrary values or inline styles; also checks that its own patterns catch known violations.
