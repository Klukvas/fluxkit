/**
 * The home page as configuration (AGENTS.md section 2.2): which sections appear, in which order, with which props. A
 * section is rendered by the registry in `components/home-sections.tsx`; text is message keys, never literal strings.
 * `categoryTiles` and `newProducts` get their data from `lib/catalog-data.ts` (`loadHomeData`).
 */

export type HomeSection =
  | {
      type: "hero";
      props: { titleKey: string; descriptionKey: string; ctaKey: string; ctaHref: string };
    }
  | {
      type: "categoryTiles";
      props: {
        /** Most top-level categories shown as tiles. */
        limit: number;
        titleKey: string;
        emptyTitleKey: string;
        emptyDescriptionKey: string;
      };
    }
  | {
      type: "newProducts";
      props: {
        /** `limit` of `GET /store/products` (newest first). */
        limit: number;
        titleKey: string;
        allKey: string;
        emptyTitleKey: string;
        emptyDescriptionKey: string;
      };
    };

export type HomeSectionType = HomeSection["type"];

export const homeSections: readonly HomeSection[] = [
  {
    type: "hero",
    props: {
      titleKey: "home.hero.title",
      descriptionKey: "home.hero.description",
      ctaKey: "home.hero.cta",
      ctaHref: "/catalog",
    },
  },
  {
    type: "categoryTiles",
    props: {
      limit: 6,
      titleKey: "home.categoryTiles.title",
      emptyTitleKey: "home.categoryTiles.empty.title",
      emptyDescriptionKey: "home.categoryTiles.empty.description",
    },
  },
  {
    type: "newProducts",
    props: {
      limit: 8,
      titleKey: "home.newProducts.title",
      allKey: "home.newProducts.all",
      emptyTitleKey: "home.newProducts.empty.title",
      emptyDescriptionKey: "home.newProducts.empty.description",
    },
  },
];
