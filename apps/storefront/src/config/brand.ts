/**
 * The shop's brand assets: logo, browser icons, theme colour and the default social picture. FORK-OWNED: upstream creates this
 * file once and never edits it again, so a client fork fills it without merge conflicts (plan 2026-11-08-design-changeability.md,
 * principle 6; contract `docs/contracts/branding.md`; how-to `docs/customization.md`). The values below are the template's
 * defaults and render exactly what the template rendered before this file existed: a text logo and no icon, theme-color or
 * og:image tags. The types and every reader are in `lib/brand.ts`.
 *
 * NOT here: the shop name (`site.name`, `site.title` in `src/messages-overrides/<locale>.json`), the colours and fonts
 * (`packages/theme/src/tokens.css`, `config/fonts.ts`), the sender name of mails (`EMAIL_FROM`).
 *
 * Example of a filled file (pictures in `apps/storefront/public/brand/`):
 *
 *   export const brand: BrandConfig = {
 *     logo: {
 *       kind: "image",
 *       light: { src: "/brand/logo.svg", width: 120, height: 32 },
 *       dark: { src: "/brand/logo-dark.svg", width: 120, height: 32 },
 *     },
 *     icons: [{ src: "/brand/icon.svg", type: "image/svg+xml", sizes: "any" }],
 *     appleIcon: { src: "/brand/apple-icon.png" },
 *     themeColor: { light: "#ffffff", dark: "#0b1020" },
 *     ogImage: { src: "/brand/og.png", width: 1200, height: 630 },
 *   };
 */
import type { BrandConfig } from "../lib/brand";

export const brand: BrandConfig = {
  logo: { kind: "text" },
  icons: [],
  appleIcon: null,
  themeColor: null,
  ogImage: null,
};
