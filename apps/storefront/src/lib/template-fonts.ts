import localFont from "next/font/local";
import type { ShopFont } from "../config/fonts";

// Template-owned; forks supply their own faces through config/fonts.ts and token overrides. The official TTF, byte for byte
// (fonts/README.md): the owner's OFL approval covers unmodified files, and the OFL counts a format change as a modification.
const rubik = localFont({
  src: [{ path: "./fonts/rubik-wght.ttf", weight: "300 900", style: "normal" }],
  variable: "--font-template-sans",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});

export const templateFonts: readonly ShopFont[] = [rubik];
