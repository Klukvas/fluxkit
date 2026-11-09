import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  brandConfigProblems,
  brandIconsMetadata,
  brandOpenGraphImages,
  brandThemeColor,
  type BrandConfig,
} from "../lib/brand";
import { messagesByLocale } from "../messages";
import { brand } from "./brand";

const publicDir = fileURLToPath(new URL("../../public", import.meta.url));
const tokensCss = readFileSync(
  fileURLToPath(new URL("../../../../packages/theme/src/tokens.css", import.meta.url)),
  "utf8",
);

/** `--fk-color-background` of one theme block of tokens.css (the effective value: the storefront has no overrides file). */
function background(selector: string): string {
  const start = tokensCss.indexOf(`${selector} {`);
  expect(start, `${selector} block in tokens.css`).toBeGreaterThanOrEqual(0);
  const block = tokensCss.slice(start, tokensCss.indexOf("}", start));
  const value = /--fk-color-background:\s*(#[0-9a-fA-F]{6});/.exec(block)?.[1];
  expect(value, `--fk-color-background in ${selector}`).toBeDefined();
  return (value as string).toLowerCase();
}

const filled: BrandConfig = {
  logo: {
    kind: "image",
    light: { src: "/brand/logo.svg", width: 120, height: 32 },
    dark: { src: "/brand/logo-dark.svg", width: 120, height: 32 },
  },
  icons: [{ src: "/brand/icon.svg", type: "image/svg+xml", sizes: "any" }],
  appleIcon: { src: "/brand/apple-icon.png" },
  themeColor: { light: "#ffffff", dark: "#0b1020" },
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

  it("keeps theme-color equal to the page background of each theme (--fk-color-background, light and dark)", () => {
    if (brand.themeColor === null) return;
    expect(brand.themeColor.light.toLowerCase()).toBe(background(':root,\n[data-theme="light"]'));
    expect(brand.themeColor.dark.toLowerCase()).toBe(background('[data-theme="dark"]'));
  });

  it("the guard above reads the real backgrounds (the example colours of the file's comment are today's tokens)", () => {
    expect(background(':root,\n[data-theme="light"]')).toBe(filled.themeColor?.light);
    expect(background('[data-theme="dark"]')).toBe(filled.themeColor?.dark);
  });
});

describe("lib/brand.ts", () => {
  const t = createTranslator(messagesByLocale.en, "en");

  it("renders nothing for the template's defaults (no icon link, no theme-color, no og:image)", () => {
    const defaults: BrandConfig = {
      logo: { kind: "text" },
      icons: [],
      appleIcon: null,
      themeColor: null,
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

  it("gives one theme-color for a fixed theme and the media pair for system", () => {
    expect(brandThemeColor(filled.themeColor, "light")).toBe("#ffffff");
    expect(brandThemeColor(filled.themeColor, "dark")).toBe("#0b1020");
    expect(brandThemeColor(filled.themeColor, "system")).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#ffffff" },
      { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
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

  it("reports remote or odd paths, sizes that are not whole pixels and colours that are not 6-digit hex", () => {
    const bad = {
      ...filled,
      logo: {
        kind: "image",
        light: { src: "/../secret.svg", width: 0, height: 32 },
        darkSafe: true,
      },
      icons: [{ src: "//cdn.example/icon.svg", type: "image/svg+xml", sizes: "any" }],
      themeColor: { light: "white", dark: "#0b1020" },
      ogImage: { src: "/brand/og.png", width: 1200.5, height: 630 },
    } as unknown as BrandConfig;
    expect(brandConfigProblems(bad)).toEqual([
      "logo.light.src must be a file under public/",
      "logo.light needs its width and height in whole pixels",
      "ogImage needs its width and height in whole pixels",
      "icon //cdn.example/icon.svg must be a file under public/",
      "themeColor.light must be a 6-digit hex",
    ]);
    expect(brandConfigProblems(filled)).toEqual([]);
  });
});
