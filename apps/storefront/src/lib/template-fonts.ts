import localFont from "next/font/local";
import type { ShopFont } from "../config/fonts";

// Template-owned; forks supply their own faces through config/fonts.ts and token overrides. The file is Google's Rubik TTF
// converted losslessly to WOFF2 (fonts/README.md). `optional`, not `swap`: without a preload the face arrives after the first
// paint on a cold visit, and swapping it in re-wrapped the text (layout shift 0.178 on the register page at 390 px, e2e
// `first-html`); with `optional` that view keeps the size-adjusted fallback and later pages use the cached face.
const rubik = localFont({
  src: [{ path: "./fonts/rubik-wght.woff2", weight: "300 900", style: "normal" }],
  variable: "--font-template-sans",
  display: "optional",
  preload: false,
  adjustFontFallback: "Arial",
});

export const templateFonts: readonly ShopFont[] = [rubik];
