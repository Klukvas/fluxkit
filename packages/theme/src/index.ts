export const themeNames = ["light", "dark"] as const;
export type ThemeName = (typeof themeNames)[number];
export const defaultTheme: ThemeName = "light";
