/*
 * FIXTURE (test only, not shipped): `email-theme.ts` as a fork that rebranded in its storefront overrides file updates it, with the
 * literals the spec's failure message names for the filled overrides fixture next to this file (the A1 "Verde Kopi" palette).
 * `vitest.brand-fork.config.ts` puts it in place of the real file.
 */

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) {
      deepFreeze(child as object);
    }
  }
  return Object.freeze(value);
}

export const emailTheme = deepFreeze({
  color: {
    background: "#fbf8f3",
    foreground: "#17241e",
    muted: "#f2ede4",
    mutedForeground: "#56605a",
    border: "#e4ddd0",
    primary: "#1f5f4a",
    primaryForeground: "#ffffff",
    danger: "#b42318",
    success: "#1d6f3a",
    warning: "#975200",
  },
  font: {
    sans: "ui-sans-serif, system-ui, sans-serif",
    mono: "ui-monospace, monospace",
  },
  radius: { sm: "2px", md: "4px", lg: "8px" },
  space: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
  fontSize: { small: "13px", body: "15px", heading: "20px" },
  lineHeight: "1.5",
  contentWidth: 600,
});

export type EmailThemeValues = typeof emailTheme;
