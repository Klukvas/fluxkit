import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { themeColors } from "@fluxkit/theme";
import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  brandConfigProblems,
  brandIconsMetadata,
  brandOpenGraphImages,
  brandThemeColor,
  isPublicFilePath,
  type BrandConfig,
} from "../lib/brand";
import { messagesByLocale } from "../messages";
import { brand } from "./brand";

const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

const filled: BrandConfig = {
  logo: {
    kind: "image",
    light: { src: "/brand/logo.svg", width: 120, height: 32 },
    dark: { src: "/brand/logo-dark.svg", width: 120, height: 32 },
  },
  icons: [{ src: "/brand/icon.svg", type: "image/svg+xml", sizes: "any" }],
  appleIcon: { src: "/brand/apple-icon.png" },
  themeColor: true,
  ogImage: { src: "/brand/og.png", width: 1200, height: 630 },
};

describe("config/brand.ts (fork-owned; contract docs/contracts/branding.md)", () => {
  it("passes the checks TypeScript cannot express", () => {
    expect(brandConfigProblems(brand)).toEqual([]);
  });

  it("names only files that exist under public/", () => {
    const paths = [
      ...(brand.logo.kind === "image"
        ? [brand.logo.light.src, ...("dark" in brand.logo ? [brand.logo.dark.src] : [])]
        : []),
      ...brand.icons.map((icon) => icon.src),
      ...(brand.appleIcon === null ? [] : [brand.appleIcon.src]),
      ...(brand.ogImage === null ? [] : [brand.ogImage.src]),
    ];
    for (const path of paths) expect(existsSync(`${publicDir}${path}`), path).toBe(true);
  });
});

describe("lib/brand.ts", () => {
  const t = createTranslator(messagesByLocale.en, "en");

  it("isPublicFilePath: one rule for the config check and the logo render (a file under public/ only)", () => {
    for (const ok of ["/brand/logo.svg", "/logo.png", "/a.b-c_d/e.svg"]) {
      expect(isPublicFilePath(ok), ok).toBe(true);
    }
    for (const bad of [
      "//cdn.example/logo.svg",
      "https://cdn.example/logo.svg",
      "brand/logo.svg",
      "/",
      "/../secret.svg",
      "/brand/../../x.svg",
      "/brand//logo.svg",
      "/ logo.svg",
    ]) {
      expect(isPublicFilePath(bad), bad).toBe(false);
    }
  });

  it("renders nothing for the template's defaults (no icon link, no theme-color, no og:image)", () => {
    const defaults: BrandConfig = {
      logo: { kind: "text" },
      icons: [],
      appleIcon: null,
      themeColor: false,
      ogImage: null,
    };
    expect(brandIconsMetadata(defaults)).toBeUndefined();
    expect(brandThemeColor(defaults.themeColor, "system")).toBeUndefined();
    expect(brandOpenGraphImages("https://shop.example", t, defaults.ogImage)).toBeUndefined();
  });

  it("builds the icon links of a filled config", () => {
    expect(brandIconsMetadata(filled)).toEqual({
      icon: [{ url: "/brand/icon.svg", type: "image/svg+xml", sizes: "any" }],
      apple: [{ url: "/brand/apple-icon.png" }],
    });
    expect(brandIconsMetadata({ ...filled, appleIcon: null })).toEqual({
      icon: [{ url: "/brand/icon.svg", type: "image/svg+xml", sizes: "any" }],
    });
  });

  it("gives the page background of the theme (themeColors, equal to the tokens by the theme spec): one for a fixed theme, the media pair for system", () => {
    expect(brandThemeColor(true, "light")).toBe(themeColors.light);
    expect(brandThemeColor(true, "dark")).toBe(themeColors.dark);
    expect(brandThemeColor(true, "system")).toEqual([
      { media: "(prefers-color-scheme: light)", color: themeColors.light },
      { media: "(prefers-color-scheme: dark)", color: themeColors.dark },
    ]);
  });

  it("makes the og:image absolute and names it by the shop name", () => {
    expect(brandOpenGraphImages("https://shop.example", t, filled.ogImage)).toEqual([
      {
        url: "https://shop.example/brand/og.png",
        width: 1200,
        height: 630,
        alt: messagesByLocale.en["site.name"],
      },
    ]);
  });

  it("reports remote or odd paths and sizes that are not whole pixels", () => {
    const bad: BrandConfig = {
      ...filled,
      logo: {
        kind: "image",
        light: { src: "/../secret.svg", width: 0, height: 32 },
        darkSafe: true,
      },
      icons: [{ src: "//cdn.example/icon.svg", type: "image/svg+xml", sizes: "any" }],
      ogImage: { src: "/brand/og.png", width: 1200.5, height: 630 },
    };
    expect(brandConfigProblems(bad)).toEqual([
      "logo.light.src must be a file under public/",
      "logo.light needs its width and height in whole pixels",
      "ogImage needs its width and height in whole pixels",
      "icon //cdn.example/icon.svg must be a file under public/",
    ]);
    expect(brandConfigProblems(filled)).toEqual([]);
  });
});
