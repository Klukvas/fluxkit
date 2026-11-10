import type { LocalImage } from "./home";

/**
 * FORK (reshape R4): the brand logos of the home page's brand strip (`components/fork/brand-strip.tsx`, the custom section
 * `brandStrip`). A new file of the fork.
 *
 * TODO(fluxkit): PLACEHOLDERS. The store API has no brand pictures (a brand is a name and a slug), so the logos are local
 * files listed here by hand, and the demo entries all show one neutral placeholder picture under invented names. A client
 * lists its real brands: `name` is the brand's own name (a proper noun, not translated; read to screen readers), `image` a file
 * under `public/` with its real size, `slug` the brand's slug in the catalog (the logo then links to the catalog filtered by
 * it) or `null` for a logo without a link.
 */
export interface BrandLogoEntry {
  name: string;
  slug: string | null;
  image: LocalImage;
}

const placeholder: LocalImage = {
  src: "/fork/brand-placeholder.svg",
  width: 160,
  height: 64,
  altKey: null,
};

export const brandStrip: readonly BrandLogoEntry[] = [
  { name: "Brand A", slug: null, image: placeholder },
  { name: "Brand B", slug: null, image: placeholder },
  { name: "Brand C", slug: null, image: placeholder },
  { name: "Brand D", slug: null, image: placeholder },
  { name: "Brand E", slug: null, image: placeholder },
  { name: "Brand F", slug: null, image: placeholder },
];
