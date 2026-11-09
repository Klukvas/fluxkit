export const themeNames = ["light", "dark"] as const;
export type ThemeName = (typeof themeNames)[number];
export const defaultTheme: ThemeName = "light";
export { emailTheme, type EmailThemeValues } from "./email-theme.js";
export { themeColors } from "./theme-color.js";

/**
 * What a page may put into `<html data-theme>`: a fixed theme, or `system`, which follows the OS setting through the
 * `prefers-color-scheme` block of tokens.css (opt-in: a page without it never follows the OS; the admin sets `light`).
 */
export const themeModes = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof themeModes)[number];
