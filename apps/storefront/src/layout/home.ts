/**
 * The home page as configuration (AGENTS.md section 2.2): which sections appear, in which order, with which props. A
 * section is rendered by the registry in `components/home-sections.tsx`; text is message keys, never literal strings.
 * Step 5 (catalog) fills `categoryTiles` and `newProducts` with data; until then they show their empty state.
 */

export type HomeSection =
  | {
      type: "hero";
      props: { titleKey: string; descriptionKey: string; ctaKey: string; ctaHref: string };
    }
  | {
      type: "categoryTiles";
      props: { titleKey: string; emptyTitleKey: string; emptyDescriptionKey: string };
    }
  | {
      type: "newProducts";
      props: {
        /** `limit` of `GET /store/products` (newest first); read by the section once it fetches. */
        limit: number;
        titleKey: string;
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
      emptyTitleKey: "home.newProducts.empty.title",
      emptyDescriptionKey: "home.newProducts.empty.description",
    },
  },
];
