/**
 * The home page as configuration (AGENTS.md section 2.2; review D-18, plan 2026-11-03-storefront-design-b.md): which sections
 * appear, in which order. Internal to the storefront, like `trust-bar.ts`: a client fork reorders, removes or adds entries
 * here and edits the `home.*` messages; no component changes. Texts are message keys (uk and en in `src/messages`), never
 * literal strings. `components/home-sections.tsx` renders each `kind`; a `kind` it does not know fails the TypeScript build.
 *
 * Data sections (`categories`, `productRow`, and `banners` with `source: "admin"`) read the store API through the 60 s data
 * cache; one with nothing to show is left out, and one whose read failed shows a short error while the rest of the page
 * renders. Banners are left out on a failed read instead: a promotion slot that says "could not load" helps nobody.
 *
 * Every section takes an optional `width` (default `contained`; `full` for `custom` sections only), and a `custom` section
 * renders a server component a fork registers by name in `config/custom-sections.ts` (plan 2026-11-08-design-changeability.md,
 * L4; contract: `docs/contracts/home-sections.md`). `checkHomeSections` refuses what the types cannot catch (a cast, plain
 * JavaScript).
 */

/** A picture served from `apps/storefront/public` (never a remote URL: no image host to allow, no request to a third party). */
export interface LocalImage {
  /** Path under `public/`, starting with `/`. */
  src: `/${string}`;
  /** Intrinsic size in pixels: reserves the space, so nothing moves when it loads. */
  width: number;
  height: number;
  /** Message key of the alt text; `null` for a decorative picture (the heading says it all). */
  altKey: string | null;
}

/**
 * How wide a section sits on the page:
 * - `contained` (the default): inside the page's content width (`Container`), as every section was before `width` existed.
 * - `full`: NO container: the section spans the window edge to edge and decides its own inner width and surface (a custom
 *   section renders `Container` of `@fluxkit/ui` inside its own band, for example). Only `custom` sections take it: the
 *   built-in sections have no edge-to-edge layout yet (their cards and grids would touch the window's edges).
 */
export const HOME_SECTION_WIDTHS = ["contained", "full"] as const;

export type HomeSectionWidth = (typeof HOME_SECTION_WIDTHS)[number];

interface HomeSectionBase {
  /** Unique on the page: the heading's `id` (`<id>-title`) and the section's key. */
  id: string;
  /** Default and, for the built-in kinds, only value. With every section contained the page keeps ONE container. */
  width?: "contained";
}

export interface HeroSection extends HomeSectionBase {
  kind: "hero";
  headlineKey: string;
  sublineKey?: string;
  cta?: { labelKey: string; href: string };
  image?: LocalImage;
}

export interface CategoriesSection extends HomeSectionBase {
  kind: "categories";
  titleKey: string;
  /** Most top-level categories shown (in the API's order: position, then slug). */
  limit: number;
  /** Optional picture per category slug; without one the tile shows the name on a token surface. */
  images?: Readonly<Record<string, LocalImage>>;
}

export interface ProductRowSection extends HomeSectionBase {
  kind: "productRow";
  titleKey: string;
  /** `limit` of `GET /store/products` (1 to 24 here). */
  limit: number;
  /**
   * Which products: `GET /store/products` lists the newest first (by publication date), optionally only one category (its
   * descendants included) or one brand. Nothing else is supported by the store API without search.
   */
  source: { sort: "newest"; category?: string; brand?: string };
  /** A link under the row to the full list (the category, or the catalog). */
  viewAll?: { labelKey: string };
}

export interface TrustSection extends HomeSectionBase {
  kind: "trust";
  /** Heading of the section (visually hidden: the bar's lines speak for themselves). */
  titleKey: string;
}

export interface RichTextSection extends HomeSectionBase {
  kind: "richText";
  titleKey?: string;
  /** Plain text; a blank line starts a new paragraph. No HTML. */
  bodyKey: string;
}

/** The most banners one `banners` section shows (one row on desktop); `GET /store/banners` returns at most as many. */
export const MAX_BANNERS = 3;

/**
 * Colour of a banner card, from tokens only: `surface` = background and border, `accent` = the `--fk-color-accent` pair (equal to
 * the primary colour by default). The tone name is not Tailwind's `accent-*` utility (the CSS property of checkbox ticks).
 */
export type BannerTone = "surface" | "accent";

export interface Banner {
  /** Unique within its section: part of the card's heading id. */
  id: string;
  titleKey: string;
  textKey: string;
  /**
   * Where the whole card links to: a storefront path without the locale (`/catalog`), or an absolute `https://` address
   * (opens in the same tab). The same rule as the admin's banners (`lib/home-banners.ts`); anything else fails the render.
   */
  href: string;
  /** With its own background drawn in, so it reads on the light and the dark theme. */
  image: LocalImage;
  /** Default `surface`. */
  tone?: BannerTone;
}

/** 0 to `MAX_BANNERS` banners: a fourth one fails the TypeScript build. */
export type BannerList =
  readonly [] | readonly [Banner] | readonly [Banner, Banner] | readonly [Banner, Banner, Banner];

interface BannersSectionBase extends HomeSectionBase {
  kind: "banners";
  /** Heading of the section (visually hidden: the cards' titles speak for themselves). */
  titleKey: string;
}

/**
 * The banners the shop manages in the admin (plan 2026-11-05-admin-home-banners.md, D6): `GET /store/banners` (at most 3,
 * live now, texts and picture already resolved for the page's locale), through the 60 s data cache, so a change shows up to
 * a minute late. No banner, or a store that cannot answer, hides the section (the failure is logged); a banner whose link or
 * data fails the storefront's own check is skipped and logged.
 */
export interface AdminBannersSection extends BannersSectionBase {
  source: "admin";
}

/** Banners in code: the typed `items`, edited by a developer (plan 2026-11-05-home-banners.md). `items: []` hides the section. */
export interface ConfigBannersSection extends BannersSectionBase {
  source: "config";
  items: BannerList;
}

/**
 * Promotional cards in one row (one column on phones). No carousel: every card is visible and nothing moves by itself.
 * `source` says where they come from; there is no fallback from one source to the other (an owner who deletes every banner
 * in the admin must not see demo banners come back).
 */
export type BannersSection = AdminBannersSection | ConfigBannersSection;

/**
 * A section of the fork's own (request "a brand strip"): `name` is a key of `customSections` in the fork-owned
 * `config/custom-sections.ts`, which maps it to a SERVER component that receives a plain view model (`CustomSectionProps` in
 * `lib/custom-sections.ts`). An unknown name fails the render in development and tests and is left out, with
 * `console.error`, in production.
 */
export interface CustomSection extends Omit<HomeSectionBase, "width"> {
  kind: "custom";
  /** Letters, digits and `-`, starting with a letter (for example `brandStrip`). */
  name: string;
  /** Default `contained`; `full` renders the component edge to edge, without a container (it chooses its own surface). */
  width?: HomeSectionWidth;
}

export type HomeSection =
  | HeroSection
  | BannersSection
  | CategoriesSection
  | ProductRowSection
  | TrustSection
  | RichTextSection
  | CustomSection;

export type HomeSectionKind = HomeSection["kind"];

/** Sections whose content comes from the store API: category tiles, a product row and the banners of the admin. */
export type HomeDataSection = CategoriesSection | ProductRowSection | AdminBannersSection;

export function isDataSection(section: HomeSection): section is HomeDataSection {
  return (
    section.kind === "categories" ||
    section.kind === "productRow" ||
    (section.kind === "banners" && section.source === "admin")
  );
}

const customSectionName = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Refuses a home config the types would refuse too, for values that got past them (a cast, plain JavaScript, JSON): a
 * duplicate id, an unknown `width`, `full` on a built-in kind, a `custom` section without a usable name. Called by every
 * render of the home page, so a broken config fails loudly instead of rendering something unexpected.
 */
export function checkHomeSections(sections: readonly HomeSection[]): void {
  const seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.id)) {
      throw new Error(`Home section id "${section.id}" is used twice; every id must be unique.`);
    }
    seen.add(section.id);
    const width: unknown = section.width;
    if (width !== undefined && !(HOME_SECTION_WIDTHS as readonly unknown[]).includes(width)) {
      throw new Error(
        `Home section "${section.id}" has the width ${JSON.stringify(width)}; allowed: ${HOME_SECTION_WIDTHS.join(", ")}.`,
      );
    }
    if (width === "full" && section.kind !== "custom") {
      throw new Error(
        `Home section "${section.id}" (${section.kind}) cannot be full width: only custom sections can (the built-in sections have no edge-to-edge layout).`,
      );
    }
    if (section.kind === "custom" && !customSectionName.test(String(section.name as unknown))) {
      throw new Error(
        `Home section "${section.id}" (custom) needs the name of a registered section (letters, digits and "-"), got ${JSON.stringify(section.name)}.`,
      );
    }
  }
}

/**
 * TODO(fluxkit): the static demo banners of the `config` source (PR 225). Not on the page by default (the template shows the
 * banners of the admin); a fork that prefers banners in code shows these, or its own, with
 * `{ kind: "banners", source: "config", id: "home-banners", titleKey: "home.banners.title", items: demoConfigBanners }`.
 *
 * Replacing them: 0 to 3 items (each `href` a storefront path without the locale or an `https://` address; `tone` `surface`
 * or `accent`), pictures under `public/home/` with their real `width`/`height` (each with its own background, so it reads on
 * the dark theme too) and the `home.banners.*` texts in BOTH `src/messages/uk/home.json` and `en/home.json`.
 */
export const demoConfigBanners: BannerList = [
  {
    id: "season",
    titleKey: "home.banners.season.title",
    textKey: "home.banners.season.text",
    href: "/catalog",
    image: {
      src: "/home/banner-1.svg",
      width: 640,
      height: 320,
      altKey: "home.banners.season.alt",
    },
    tone: "accent",
  },
  {
    id: "gifts",
    titleKey: "home.banners.gifts.title",
    textKey: "home.banners.gifts.text",
    href: "/catalog",
    image: {
      src: "/home/banner-2.svg",
      width: 640,
      height: 320,
      altKey: "home.banners.gifts.alt",
    },
  },
  {
    id: "account",
    titleKey: "home.banners.account.title",
    textKey: "home.banners.account.text",
    href: "/account/register",
    image: {
      src: "/home/banner-3.svg",
      width: 640,
      height: 320,
      altKey: "home.banners.account.alt",
    },
  },
];

/**
 * TODO(fluxkit): demo composition and copy. A client fork replaces the hero texts and picture, the "about" text and the
 * section list with its own (the trust lines are `config/trust-bar.ts`). The pictures are neutral generated illustrations.
 *
 * Banners: the shop edits them in the admin (`source: "admin"`; `pnpm seed` creates three demo ones). Removing the entry
 * hides the section and the storefront never asks the API for banners; `source: "config"` keeps them in code instead
 * (`demoConfigBanners` above).
 */
export const homeSections: readonly HomeSection[] = [
  // FORK (a1-reshape): full-bleed hero with the text overlaid, then categories, a product row, the banners, "Bestsellers" and
  // a brand-logos strip.
  { kind: "custom", id: "home-hero", name: "heroOverlay", width: "full" },
  {
    kind: "categories",
    id: "home-categories",
    titleKey: "home.categoryTiles.title",
    limit: 6,
  },
  {
    kind: "productRow",
    id: "home-new-products",
    titleKey: "home.newProducts.title",
    limit: 8,
    source: { sort: "newest" },
    viewAll: { labelKey: "home.newProducts.all" },
  },
  { kind: "banners", source: "admin", id: "home-banners", titleKey: "home.banners.title" },
  {
    // TODO(fluxkit): the store API sorts product rows by "newest" only (no sales ranking), so "Bestsellers" shows the newest
    // products until a bestseller source exists.
    kind: "productRow",
    id: "home-bestsellers",
    titleKey: "custom.home.bestsellers",
    limit: 4,
    source: { sort: "newest" },
    viewAll: { labelKey: "home.newProducts.all" },
  },
  { kind: "custom", id: "home-brands", name: "brandStrip", width: "full" },
  { kind: "trust", id: "home-trust", titleKey: "home.trust.title" },
  { kind: "richText", id: "home-about", titleKey: "home.about.title", bodyKey: "home.about.body" },
];
