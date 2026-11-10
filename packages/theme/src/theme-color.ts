/**
 * The page background (`--fk-color-background`) of the light and the dark theme as literal colours, for the storefront's
 * `<meta name="theme-color">` (plan 2026-11-08-design-changeability.md B1, `apps/storefront/src/config/brand.ts` `themeColor`):
 * HTML cannot read a CSS variable, and apps may not hold hex colours (`design-guard.spec.ts`). The same pattern as
 * `email-theme.ts`: `theme-color.spec.ts` keeps both equal to the EFFECTIVE background (`tokens.css` plus the fork-owned
 * storefront overrides file), so a fork that changes a background changes it here too; the failure names the literals to write.
 */
export const themeColors = { light: "#fbf8f2", dark: "#0d1612" } as const;
