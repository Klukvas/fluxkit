# @fluxkit/theme

Design tokens (`tokens.css`, `light` and `dark`), their Tailwind mapping (`tailwind.css`) and `emailTheme` (resolved light values for inline styles in mail, guarded against drift). Rebranding = changing token values.

- Contract and contrast rules: `docs/contracts/theme-tokens.md`. `pnpm --filter @fluxkit/theme test` checks identical token names across themes, the Tailwind mapping, WCAG contrast of the documented pairs and the design guard.
- Use hex colors in `tokens.css`; the contrast test fails on any other format.

File map: `docs/files/theme.md`.
- Use `border-input` (not `border`) for the border of anything that is an input; the contrast test checks it at 3:1 and fails for a component pair that is not covered.
