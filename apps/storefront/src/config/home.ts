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

export type HomeSection =
  HeroSection | CategoriesSection | ProductRowSection | TrustSection | RichTextSection;

export type HomeSectionKind = HomeSection["kind"];

/** Section kinds whose content comes from the store API. */
export type HomeDataSection = CategoriesSection | ProductRowSection;

export function isDataSection(section: HomeSection): section is HomeDataSection {
  return section.kind === "categories" || section.kind === "productRow";
}

/**
 * TODO(fluxkit): demo composition and copy. A client fork replaces the hero texts and picture, the "about" text and the
 * section list with its own (the trust lines are `config/trust-bar.ts`). The picture is a neutral generated illustration.
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
