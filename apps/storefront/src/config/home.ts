/**
 * The home page as configuration (AGENTS.md section 2.2; review D-18, plan 2026-11-03-storefront-design-b.md): which sections
 * appear, in which order. Internal to the storefront, like `trust-bar.ts`: a client fork reorders, removes or adds entries
 * here and edits the `home.*` messages; no component changes. Texts are message keys (uk and en in `src/messages`), never
 * literal strings. `components/home-sections.tsx` renders each `kind`; a `kind` it does not know fails the TypeScript build.
 *
 * Data sections (`categories`, `productRow`, and `banners` with `source: "admin"`) read the store API through the 60 s data
 * cache; one with nothing to show is left out, and one whose read failed shows a short error while the rest of the page
 * renders. Banners are left out on a failed read instead: a promotion slot that says "could not load" helps nobody.
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

export interface HeroSection {
  kind: "hero";
  /** Unique on the page: the heading's `id` and the section's key. */
  id: string;
  headlineKey: string;
  sublineKey?: string;
  cta?: { labelKey: string; href: string };
  image?: LocalImage;
}

export interface CategoriesSection {
  kind: "categories";
  id: string;
  titleKey: string;
  /** Most top-level categories shown (in the API's order: position, then slug). */
  limit: number;
  /** Optional picture per category slug; without one the tile shows the name on a token surface. */
  images?: Readonly<Record<string, LocalImage>>;
}

export interface ProductRowSection {
  kind: "productRow";
  id: string;
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

export interface TrustSection {
  kind: "trust";
  id: string;
  /** Heading of the section (visually hidden: the bar's lines speak for themselves). */
  titleKey: string;
}

export interface RichTextSection {
  kind: "richText";
  id: string;
  titleKey?: string;
  /** Plain text; a blank line starts a new paragraph. No HTML. */
  bodyKey: string;
}

/** The most banners one `banners` section shows (one row on desktop); `GET /store/banners` returns at most as many. */
export const MAX_BANNERS = 3;

/** Colour of a banner card, from existing tokens only: `surface` = background and border, `accent` = the primary colour. */
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

interface BannersSectionBase {
  kind: "banners";
  id: string;
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

export type HomeSection =
  | HeroSection
  | BannersSection
  | CategoriesSection
  | ProductRowSection
  | TrustSection
  | RichTextSection;

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

/**
 * TODO(fluxkit): the static demo banners of the `config` source (PR 225). Not on the page by default (the template shows the
 * banners of the admin); a fork that prefers banners in code shows these, or its own, with
 * `{ kind: "banners", source: "config", id: "home-banners", titleKey: "home.banners.title", items: demoConfigBanners }`.
 *
 * Replacing them: 0 to 3 items (each `href` a storefront path without the locale or an `https://` address; `tone` `surface`
 * or `accent`), pictures under `public/home/` with their real `width`/`height` (each with its own background, so it reads on
 * the dark theme too) and the `home.banners.*` texts in BOTH `src/messages/uk.json` and `en.json`.
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
  {
    kind: "hero",
    id: "home-hero",
    headlineKey: "home.hero.title",
    sublineKey: "home.hero.description",
    cta: { labelKey: "home.hero.cta", href: "/catalog" },
    image: { src: "/home/hero.svg", width: 640, height: 480, altKey: null },
  },
  { kind: "banners", source: "admin", id: "home-banners", titleKey: "home.banners.title" },
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
  { kind: "trust", id: "home-trust", titleKey: "home.trust.title" },
  { kind: "richText", id: "home-about", titleKey: "home.about.title", bodyKey: "home.about.body" },
];
