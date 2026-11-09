import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messagesByLocale } from "../messages";
import { localizedHref } from "../lib/locale-path";
import { bannerLink, checkBannersSection } from "../lib/home-banners";
import { categoryPageConfig } from "./category-page";
import {
  demoConfigBanners,
  homeSections,
  isDataSection,
  MAX_BANNERS,
  type AdminBannersSection,
  type Banner,
  type BannerList,
  type BannersSection,
  type ConfigBannersSection,
  type HomeSection,
  type LocalImage,
} from "./home";

const { uk, en } = messagesByLocale;

// Compile-time checks (`pnpm typecheck` fails if they break): a fourth banner, an unknown section kind, a banners section
// without its source and a source with the other source's fields are type errors.
type Assignable<From, To> = [From] extends [To] ? true : false;
const fourBannersRejected: Assignable<readonly [Banner, Banner, Banner, Banner], BannerList> =
  false;
const threeBannersAccepted: Assignable<readonly [Banner, Banner, Banner], BannerList> = true;
const unknownKindRejected: Assignable<{ kind: "carousel"; id: string }, HomeSection> = false;
const sourceRequired: Assignable<
  { kind: "banners"; id: string; titleKey: string; items: BannerList },
  HomeSection
> = false;
const adminWithoutItems: Assignable<AdminBannersSection, { items: unknown }> = false;
const configNeedsItems: Assignable<
  { kind: "banners"; source: "config"; id: string; titleKey: string },
  HomeSection
> = false;

const publicRoot = join(import.meta.dirname, "..", "..", "public");

/** The section of the template that shows `demoConfigBanners` when a fork switches to `source: "config"`. */
const demoConfigSection: ConfigBannersSection = {
  kind: "banners",
  source: "config",
  id: "home-banners",
  titleKey: "home.banners.title",
  items: demoConfigBanners,
};

function bannerKeys(banners: readonly Banner[]): string[] {
  return banners.flatMap((banner) => [
    banner.titleKey,
    banner.textKey,
    ...(banner.image.altKey === null ? [] : [banner.image.altKey]),
  ]);
}

function messageKeys(section: HomeSection): string[] {
  switch (section.kind) {
    case "hero":
      return [
        section.headlineKey,
        ...(section.sublineKey === undefined ? [] : [section.sublineKey]),
        ...(section.cta === undefined ? [] : [section.cta.labelKey]),
        ...(section.image?.altKey ? [section.image.altKey] : []),
      ];
    case "banners":
      return [section.titleKey, ...(section.source === "config" ? bannerKeys(section.items) : [])];
    case "categories":
      return [section.titleKey];
    case "productRow":
      return [
        section.titleKey,
        ...(section.viewAll === undefined ? [] : [section.viewAll.labelKey]),
      ];
    case "trust":
      return [section.titleKey];
    case "richText":
      return [...(section.titleKey === undefined ? [] : [section.titleKey]), section.bodyKey];
  }
}

function images(section: HomeSection): LocalImage[] {
  if (section.kind === "hero") return section.image === undefined ? [] : [section.image];
  if (section.kind === "categories") return Object.values(section.images ?? {});
  if (section.kind === "banners" && section.source === "config") {
    return section.items.map((banner) => banner.image);
  }
  return [];
}

const bannerSections = homeSections.filter(
  (section): section is BannersSection => section.kind === "banners",
);

describe("home config", () => {
  it("rejects a fourth banner, an unknown section kind and a banners section without a matching source at compile time", () => {
    expect([
      fourBannersRejected,
      threeBannersAccepted,
      unknownKindRejected,
      sourceRequired,
      adminWithoutItems,
      configNeedsItems,
    ]).toEqual([false, true, false, false, false, false]);
  });

  it("lists the demo composition in order: hero, banners, categories, newest products, trust bar, about text", () => {
    expect(homeSections.map((section) => section.kind)).toEqual([
      "hero",
      "banners",
      "categories",
      "productRow",
      "trust",
      "richText",
    ]);
  });

  it("gives every section a unique id (it becomes the heading id)", () => {
    const ids = homeSections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("refers only to message keys that exist in uk and en (the config demo banners included)", () => {
    for (const section of [...homeSections, demoConfigSection]) {
      for (const key of messageKeys(section)) {
        expect(key in en, `${section.id}: ${key} in en`).toBe(true);
        expect(key in uk, `${section.id}: ${key} in uk`).toBe(true);
      }
    }
  });

  it("asks the API for sensible amounts", () => {
    for (const section of homeSections) {
      if (section.kind === "categories" || section.kind === "productRow") {
        expect(section.limit, section.id).toBeGreaterThan(0);
        expect(section.limit, section.id).toBeLessThanOrEqual(24);
      }
    }
  });

  it("links only plain storefront paths", () => {
    for (const section of homeSections) {
      if (section.kind === "hero" && section.cta !== undefined) {
        expect(() => localizedHref("uk", section.cta?.href ?? "")).not.toThrow();
      }
    }
  });

  it("shows the banners of the admin by default: one data section, read from the store API", () => {
    expect(bannerSections).toEqual([
      { kind: "banners", source: "admin", id: "home-banners", titleKey: "home.banners.title" },
    ]);
    for (const section of bannerSections) expect(isDataSection(section)).toBe(true);
    expect(isDataSection(demoConfigSection)).toBe(false);
    expect(MAX_BANNERS).toBe(3);
  });

  it("keeps 1 to 3 demo banners for the config source, with safe links, distinct ids and a tone from the tokens", () => {
    expect(demoConfigBanners.length).toBeGreaterThan(0);
    expect(demoConfigBanners.length).toBeLessThanOrEqual(MAX_BANNERS);
    expect(() => {
      checkBannersSection(demoConfigSection);
    }).not.toThrow();
    for (const banner of demoConfigBanners) {
      for (const locale of ["uk", "en"] as const) {
        expect(() => bannerLink(locale, banner.href), banner.href).not.toThrow();
      }
      expect(["surface", "accent", undefined]).toContain(banner.tone);
      // Every banner picture says what it shows (the card's name is its title; the alt describes the picture).
      expect(banner.image.altKey, banner.id).not.toBeNull();
    }
  });

  it("uses pictures that exist under public/, with their real size (no layout shift)", () => {
    const all = [
      ...[...homeSections, demoConfigSection].flatMap(images),
      ...Object.values(categoryPageConfig.images),
    ];
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((image) => image.src.startsWith("/home/banner-"))).toHaveLength(3);
    for (const image of all) {
      const file = join(publicRoot, image.src);
      expect(existsSync(file), image.src).toBe(true);
      if (image.src.endsWith(".svg")) {
        const svg = readFileSync(file, "utf8");
        expect(svg, image.src).toContain(`viewBox="0 0 ${image.width} ${image.height}"`);
        // A picture from the template must not load anything (no script, no remote reference).
        expect(svg).not.toMatch(/<script|href=|url\(/i);
      }
    }
  });
});
