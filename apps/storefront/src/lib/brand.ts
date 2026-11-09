import { themeColors, type ThemeMode } from "@fluxkit/theme";
import type { Translator } from "@fluxkit/ui";
import type { Metadata, Viewport } from "next";
import { absoluteUrl } from "./seo";

/**
 * Types and pure helpers of the storefront brand config (`config/brand.ts`, plan 2026-11-08-design-changeability.md B1; contract
 * `docs/contracts/branding.md`). The config file holds data only and is fork-owned; everything that reads it lives here, so
 * upstream can change how a field is used without editing the fork's file. The shop NAME is not here: it stays in the messages
 * (`site.name`, `site.title`), overridden through `src/messages-overrides/<locale>.json`.
 */

/** A file under `public/` (a site-relative path, starting with one `/`) with its intrinsic size in pixels. */
export interface BrandPicture {
  src: `/${string}`;
  width: number;
  height: number;
}

/**
 * The header logo. `text` (the template's default) is the shop name from `site.name` in the display face. `image` is a picture:
 * one for the light theme and one for the dark theme (switched by CSS on `<html data-theme>`, `app/globals.css`), or one picture
 * that reads on both backgrounds, which the fork must state with `darkSafe: true`. Its alternative text is the shop name.
 * SVG is recommended (sharp at every size, and a `currentColor`-free SVG keeps its colours in forced-colours mode).
 */
export type BrandLogo =
  | { kind: "text" }
  | { kind: "image"; light: BrandPicture; dark: BrandPicture }
  | { kind: "image"; light: BrandPicture; darkSafe: true };

/** One `<link rel="icon">` (or `apple-touch-icon`): a file under `public/`, its MIME type and its pixel dimensions (`any` for SVG). */
export interface BrandIcon {
  src: `/${string}`;
  type: string;
  sizes: string;
}

export interface BrandConfig {
  logo: BrandLogo;
  /** Browser tab icons. Empty: no icon link (the browser then asks for `/favicon.ico` itself). */
  icons: readonly BrandIcon[];
  /**
   * The home-screen icon of iOS (`<link rel="apple-touch-icon">`), a 180 x 180 PNG; `null` for none. Only the path: iOS needs
   * no type or dimensions, and every byte of the head counts on every page (plan B1: at most 300 bytes for the whole config).
   */
  appleIcon: { src: `/${string}` } | null;
  /**
   * `true`: `<meta name="theme-color">` with the page background of the rendered theme (`themeColors` of `@fluxkit/theme`,
   * kept equal to `--fk-color-background` by its spec), so the browser UI matches the page. `false`: no tag.
   */
  themeColor: boolean;
  /**
   * The social preview picture (`og:image`) of pages that have none of their own (home, catalog and category lists, shop
   * pages, a product without a picture). Usually 1200 x 630 PNG or JPEG (social sites do not show SVG); `null` for none.
   */
  ogImage: BrandPicture | null;
}

/** The checks of a brand config that TypeScript cannot express; `config/brand.spec.ts` fails on any of them. */
export function brandConfigProblems(config: BrandConfig): string[] {
  const problems: string[] = [];
  const pictures: [string, BrandPicture][] = [];
  if (config.logo.kind === "image") {
    pictures.push(["logo.light", config.logo.light]);
    if ("dark" in config.logo) pictures.push(["logo.dark", config.logo.dark]);
  }
  if (config.ogImage !== null) pictures.push(["ogImage", config.ogImage]);
  for (const [name, picture] of pictures) {
    if (!isPublicPath(picture.src)) problems.push(`${name}.src must be a file under public/`);
    if (!isPositiveInteger(picture.width) || !isPositiveInteger(picture.height)) {
      problems.push(`${name} needs its width and height in whole pixels`);
    }
  }
  const icons = [...config.icons, ...(config.appleIcon === null ? [] : [config.appleIcon])];
  for (const icon of icons) {
    if (!isPublicPath(icon.src)) problems.push(`icon ${icon.src} must be a file under public/`);
  }
  return problems;
}

function isPublicPath(src: string): boolean {
  return /^\/[A-Za-z0-9._-]/.test(src) && !src.includes("..") && !src.includes("//");
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** The layout's `icons` metadata; `undefined` without any icon, so nothing is rendered (today's head, byte for byte). */
export function brandIconsMetadata(config: BrandConfig): Metadata["icons"] {
  if (config.icons.length === 0 && config.appleIcon === null) return undefined;
  const link = (icon: BrandIcon) => ({ url: icon.src, type: icon.type, sizes: icon.sizes });
  return {
    icon: config.icons.map(link),
    ...(config.appleIcon === null ? {} : { apple: [{ url: config.appleIcon.src }] }),
  };
}

/**
 * `theme-color` for the theme the page is rendered in (the layout reads the cookie as it does for `<html data-theme>`): one
 * colour for `light` or `dark`, the pair with media queries for `system`. Nothing when the config turns it off.
 */
export function brandThemeColor(enabled: boolean, mode: ThemeMode): Viewport["themeColor"] {
  if (!enabled) return undefined;
  if (mode === "system") {
    return [
      { media: "(prefers-color-scheme: light)", color: themeColors.light },
      { media: "(prefers-color-scheme: dark)", color: themeColors.dark },
    ];
  }
  return themeColors[mode];
}

/**
 * The default `og:image` of a page's `openGraph` (Next REPLACES a parent's `openGraph` instead of merging it, so every builder
 * that writes one adds this itself). Absolute, from the public origin; the alternative text is the shop name.
 */
export function brandOpenGraphImages(
  origin: string,
  t: Translator,
  image: BrandPicture | null,
): { url: string; width: number; height: number; alt: string }[] | undefined {
  if (image === null) return undefined;
  return [
    {
      url: absoluteUrl(origin, image.src),
      width: image.width,
      height: image.height,
      alt: t("site.name"),
    },
  ];
}
