# @fluxkit/theme

Design tokens (`tokens.css`, `light` and `dark`, plus the opt-in `system` mode block that follows the device only for `data-theme="system"`), their Tailwind mapping (`tailwind.css`) and `emailTheme` (resolved light values for inline styles in mail, guarded against drift). Rebranding = changing token values.

- Contract and contrast rules: `docs/contracts/theme-tokens.md`. `pnpm --filter @fluxkit/theme test` checks that non-colour tokens are defined once (light block), that dark and system hold the same colour and shadow names, the Tailwind mapping, WCAG contrast of the documented pairs and the design guard.
- Use hex colors in `tokens.css`; the contrast test fails on any other format.
- Radii are roles (`--fk-radius-control|card|overlay|media`, utilities `rounded-control|card|overlay|media`; literal rem values): rebrand a role, not a size step. `rounded-full` is a shape, not a role. The size steps `--fk-radius-sm|md|lg` stay for forks and for the parts in the guard's exception list (`docs/contracts/theme-tokens.md`, "Radius roles").

File map: `docs/files/theme.md`.
- Use `border-input` (not `border`) for the border of anything that is an input; the contrast test checks it at 3:1 and fails for a component pair that is not covered.
