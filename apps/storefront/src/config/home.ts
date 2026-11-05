/**
 * The home page as configuration (AGENTS.md section 2.2; review D-18, plan 2026-11-03-storefront-design-b.md): which sections
 * appear, in which order. Internal to the storefront, like `trust-bar.ts`: a client fork reorders, removes or adds entries
 * here and edits the `home.*` messages; no component changes. Texts are message keys (uk and en in `src/messages`), never
 * literal strings. `components/home-sections.tsx` renders each `kind`; a `kind` it does not know fails the TypeScript build.
 *
 * Data sections (`categories`, `productRow`) read the store API through the 60 s data cache; one with nothing to show is left
 * out, and one whose read failed shows a short error while the rest of the page renders.
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

/** The most banners one `banners` section shows (one row on desktop). */
export const MAX_BANNERS = 3;

/** Colour of a banner card, from existing tokens only: `surface` = background and border, `accent` = the primary colour. */
export type BannerTone = "surface" | "accent";

export interface Banner {
  /** Unique within its section: part of the card's heading id. */
  id: string;
  titleKey: string;
  textKey: string;
  /**
   * Where the whole card links to: a storefront path without the locale (`/catalog`, checked like the hero's link), or an
   * absolute `https://` address (opens in the same tab). Anything else fails the render (`lib/home-banners.ts`).
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

/**
 * Promotional cards in one row (one column on phones). No carousel: every card is visible and nothing moves by itself
 * (plan 2026-11-05-home-banners.md). An empty `items` hides the section.
 */
export interface BannersSection {
  kind: "banners";
  id: string;
  /** Heading of the section (visually hidden: the cards' titles speak for themselves). */
  titleKey: string;
  items: BannerList;
}

export type HomeSection =
  | HeroSection
  | BannersSection
  | CategoriesSection
  | ProductRowSection
  | TrustSection
  | RichTextSection;

export type HomeSectionKind = HomeSection["kind"];

/** Section kinds whose content comes from the store API. */
export type HomeDataSection = CategoriesSection | ProductRowSection;

export function isDataSection(section: HomeSection): section is HomeDataSection {
  return section.kind === "categories" || section.kind === "productRow";
}

/**
 * TODO(fluxkit): demo composition and copy. A client fork replaces the hero texts and picture, the banners, the "about" text
 * and the section list with its own (the trust lines are `config/trust-bar.ts`). The pictures are neutral generated
 * illustrations.
 *
 * Replacing the banners: edit `items` of `home-banners` below (0 to 3; each `href` a storefront path or an `https://` address;
 * `tone` `surface` or `accent`), put the pictures under `public/home/` with their real `width`/`height` (each with its own
 * background, so it reads on the dark theme too) and change the `home.banners.*` texts in BOTH `src/messages/uk.json` and
 * `en.json`. `items: []` or removing the entry hides the section.
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
  {
    kind: "banners",
    id: "home-banners",
    titleKey: "home.banners.title",
    items: [
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
    ],
  },
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
