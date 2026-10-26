/*
 * Email-safe design values (ADR 0031 decision 13 and 14). Mail clients do not support CSS variables, so mail templates
 * get resolved values for inline styles. Colors, fonts and radii are the LIGHT values of `tokens.css` (dark mode is not
 * attempted in mail); `email-theme.spec.ts` fails when they drift from the tokens. Radii are in pixels (1rem = 16px):
 * mail clients handle `rem` poorly. Spacing, font sizes, line height and the content width exist for mail only and
 * have no CSS token. Rebranding mail = changing `tokens.css` (and these mail-only values); never a template.
 * The shape is the `EmailTheme` interface of `@fluxkit/core` (template contract).
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
    background: "#ffffff",
    foreground: "#0f172a",
    muted: "#f1f5f9",
    mutedForeground: "#475569",
    border: "#e2e8f0",
    primary: "#4f46e5",
    primaryForeground: "#ffffff",
    danger: "#b91c1c",
    success: "#15803d",
    warning: "#b45309",
  },
  font: {
    sans: "ui-sans-serif, system-ui, sans-serif",
    mono: "ui-monospace, monospace",
  },
  radius: { sm: "4px", md: "8px", lg: "16px" },
  space: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
  fontSize: { small: "13px", body: "15px", heading: "20px" },
  lineHeight: "1.5",
  contentWidth: 600,
});

export type EmailThemeValues = typeof emailTheme;
