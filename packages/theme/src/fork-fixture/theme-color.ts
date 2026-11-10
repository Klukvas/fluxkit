/*
 * FIXTURE (test only, not shipped): `theme-color.ts` as a fork that rebranded in its storefront overrides file updates it, with the
 * literals the spec's failure message names for the filled overrides fixture next to this file (the A1 "Verde Kopi" palette).
 * `vitest.brand-fork.config.ts` puts it in place of the real file.
 */
export const themeColors = { light: "#fbf8f3", dark: "#0f1713" } as const;
